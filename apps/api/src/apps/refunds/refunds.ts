import {
  REFUND_REASON_CODES,
  REFUND_REJECT_CODES,
  canRefund,
  formatMoney,
  needsSecondApproval,
  type AppSummary,
  type AppUser,
  type Charge,
  type Refund,
  type RefundAction,
  type RefundRole,
} from '@kyc/shared';
import type { DB } from '../../platform/db.js';
import { appendAudit, diff } from '../../platform/audit.js';
import { HttpError } from '../../platform/errors.js';
import { issueProcessorRefund } from './processor.js';

type RefundUser = AppUser<RefundRole>;

interface RefundRow {
  id: string;
  charge_id: string;
  customer_name: string;
  charge_amount: number;
  currency: string;
  amount: number;
  reason_code: string;
  note: string | null;
  status: Refund['status'];
  requester_id: string;
  first_approver_id: string | null;
  second_approver_id: string | null;
  reject_reason_code: string | null;
  processor_refund_id: string | null;
  created_at: string;
  updated_at: string;
}

const SELECT = `SELECT r.*, c.customer_name, c.amount AS charge_amount, c.currency FROM refunds r JOIN charges c ON c.id = r.charge_id`;
const AUDITED: (keyof Refund)[] = ['status', 'firstApproverId', 'secondApproverId', 'rejectReasonCode', 'processorRefundId'];

function toRefund(r: RefundRow): Refund {
  return {
    id: r.id,
    chargeId: r.charge_id,
    customerName: r.customer_name,
    chargeAmount: r.charge_amount,
    amount: r.amount,
    currency: r.currency,
    reasonCode: r.reason_code,
    note: r.note,
    status: r.status,
    requesterId: r.requester_id,
    firstApproverId: r.first_approver_id,
    secondApproverId: r.second_approver_id,
    rejectReasonCode: r.reject_reason_code,
    processorRefundId: r.processor_refund_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function load(db: DB, id: string): Refund {
  const row = db.prepare(`${SELECT} WHERE r.id = ?`).get(id) as RefundRow | undefined;
  if (!row) throw new HttpError(404, `Refund ${id} not found`);
  return toRefund(row);
}

function authorize(user: RefundUser, action: RefundAction, r?: Refund) {
  const d = canRefund(user, action, r);
  if (!d.ok) throw new HttpError(403, d.reason);
}

const ownKey = (codes: Record<string, string>, v: unknown): v is string => typeof v === 'string' && Object.hasOwn(codes, v);

export const REFUND_FILTERS = ['all', 'mine', 'needs_me', 'pending', 'issued', 'rejected'] as const;
export type RefundFilter = (typeof REFUND_FILTERS)[number];

export function listRefunds(db: DB, user: RefundUser, filter: RefundFilter = 'all'): Refund[] {
  const rows = (db.prepare(`${SELECT} ORDER BY r.created_at DESC`).all() as RefundRow[]).map(toRefund);
  return rows
    .filter((r) => canRefund(user, 'refund.view', r).ok)
    .filter((r) => {
      switch (filter) {
        case 'all':
          return true;
        case 'mine':
          return r.requesterId === user.id;
        case 'needs_me':
          return canRefund(user, 'refund.approve', r).ok;
        case 'pending':
          return r.status === 'pending_approval' || r.status === 'pending_second_approval';
        case 'issued':
          return r.status === 'issued';
        case 'rejected':
          return r.status === 'rejected';
      }
    });
}

export function getRefund(db: DB, user: RefundUser, id: string): Refund {
  const r = load(db, id);
  authorize(user, 'refund.view', r);
  return r;
}

export function listCharges(db: DB): Charge[] {
  const rows = db
    .prepare(
      `SELECT c.*, c.amount - COALESCE((SELECT SUM(amount) FROM refunds WHERE charge_id = c.id AND status <> 'rejected'), 0) AS refundable
       FROM charges c ORDER BY c.created_at DESC`,
    )
    .all() as { id: string; customer_name: string; description: string; amount: number; currency: string; created_at: string; refundable: number }[];
  return rows.map((c) => ({
    id: c.id,
    customerName: c.customer_name,
    description: c.description,
    amount: c.amount,
    currency: c.currency,
    createdAt: c.created_at,
    refundable: c.refundable,
  }));
}

export interface CreateRefundInput {
  chargeId?: string;
  amount?: number;
  reasonCode?: string;
  note?: string;
}

export function createRefund(db: DB, user: RefundUser, input: CreateRefundInput, requestId?: string): Refund {
  authorize(user, 'refund.create');
  if (!Number.isInteger(input.amount) || (input.amount as number) <= 0) throw new HttpError(400, 'Amount must be a positive number of cents');
  if (!ownKey(REFUND_REASON_CODES, input.reasonCode)) {
    throw new HttpError(400, `Choose a refund reason: ${Object.keys(REFUND_REASON_CODES).join(', ')}`);
  }
  const amount = input.amount as number;
  return db.transaction(() => {
    const charge = listCharges(db).find((c) => c.id === input.chargeId);
    if (!charge) throw new HttpError(404, `Charge ${input.chargeId} not found`);
    if (amount > charge.refundable) throw new HttpError(400, `Only ${formatMoney(charge.refundable, charge.currency)} of this charge can still be refunded`);
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM refunds').get() as { n: number };
    const id = `RF-${2001 + n}`;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO refunds (id, charge_id, amount, reason_code, note, status, requester_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending_approval', ?, ?, ?)`,
    ).run(id, charge.id, amount, input.reasonCode, input.note?.trim() || null, user.id, now, now);
    appendAudit(db, {
      appId: 'refunds',
      actor: user,
      action: 'refund.requested',
      entityType: 'refund',
      entityId: id,
      changes: { status: { from: null, to: 'pending_approval' }, amount: { from: null, to: amount } },
      reason: input.note?.trim() ? `${input.reasonCode}: ${input.note.trim()}` : (input.reasonCode as string),
      requestId,
    });
    return load(db, id);
  })();
}

/** The single write path for refund decisions: authorize, apply, issue through the processor, audit. */
export function decideRefund(
  db: DB,
  user: RefundUser,
  id: string,
  decision: 'approve' | 'reject',
  input: { reasonCode?: string; note?: string } = {},
  requestId?: string,
): Refund {
  return db.transaction(() => {
    const before = load(db, id);
    authorize(user, `refund.${decision}`, before);
    const note = input.note?.trim() || null;
    const now = new Date().toISOString();
    let patch: Record<string, unknown>;
    let reason: string | null = note;

    if (decision === 'reject') {
      if (!ownKey(REFUND_REJECT_CODES, input.reasonCode)) {
        throw new HttpError(400, `Choose a rejection reason: ${Object.keys(REFUND_REJECT_CODES).join(', ')}`);
      }
      patch = { status: 'rejected', reject_reason_code: input.reasonCode };
      reason = note ? `${input.reasonCode}: ${note}` : input.reasonCode;
    } else if (before.status === 'pending_approval' && needsSecondApproval(before.amount)) {
      patch = { status: 'pending_second_approval', first_approver_id: user.id };
    } else {
      const processorId = issueProcessorRefund(db, { chargeId: before.chargeId, amount: before.amount, idempotencyKey: before.id });
      patch =
        before.status === 'pending_approval'
          ? { status: 'issued', first_approver_id: user.id, processor_refund_id: processorId }
          : { status: 'issued', second_approver_id: user.id, processor_refund_id: processorId };
    }

    const sets = Object.keys(patch).map((k) => `${k} = @${k}`);
    const res = db
      .prepare(`UPDATE refunds SET ${sets.join(', ')}, updated_at = @updated_at WHERE id = @id AND status = @expected`)
      .run({ ...patch, updated_at: now, id, expected: before.status });
    if (res.changes !== 1) throw new HttpError(409, 'Refund changed concurrently; reload and retry');

    const after = load(db, id);
    appendAudit(db, {
      appId: 'refunds',
      actor: user,
      action: `refund.${decision}`,
      entityType: 'refund',
      entityId: id,
      changes: diff(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, AUDITED),
      reason,
      requestId,
    });
    return after;
  })();
}

export function refundsSummary(db: DB, user: RefundUser): AppSummary {
  const visible = listRefunds(db, user);
  const pending = visible.filter((r) => r.status === 'pending_approval' || r.status === 'pending_second_approval');
  const needsMe = visible.filter((r) => canRefund(user, 'refund.approve', r).ok).length;
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const issued = visible.filter((r) => r.status === 'issued' && r.updatedAt >= weekAgo).reduce((s, r) => s + r.amount, 0);
  const money = (c: number) => `$${(c / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  return {
    metrics: [
      { label: 'Pending approval', value: `${pending.length} · ${money(pending.reduce((s, r) => s + r.amount, 0))}`, tone: pending.length ? 'warning' : 'neutral' },
      { label: 'Needs my approval', value: needsMe, tone: needsMe ? 'warning' : 'neutral' },
      { label: 'Issued (7d)', value: money(issued), tone: 'success' },
    ],
  };
}
