import {
  APPROVE_REASON_CODES,
  REJECT_REASON_CODES,
  can,
  maskSsn,
  type Action,
  type KycCase,
  type User,
} from '@kyc/shared';
import type { DB } from './db.js';
import { appendAudit, diff } from './audit.js';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

interface CaseRow {
  id: string;
  customer_name: string;
  date_of_birth: string;
  country: string;
  ssn: string;
  risk_level: KycCase['riskLevel'];
  risk_score: number;
  vendor_checks: string;
  status: KycCase['status'];
  assignee_id: string | null;
  first_approver_id: string | null;
  second_approver_id: string | null;
  decision_reason_code: string | null;
  created_at: string;
  updated_at: string;
}

/** The raw SSN never leaves this module except through revealSsn. */
function toCase(r: CaseRow): KycCase {
  return {
    id: r.id,
    customerName: r.customer_name,
    dateOfBirth: r.date_of_birth,
    country: r.country,
    ssnMasked: maskSsn(r.ssn),
    riskLevel: r.risk_level,
    riskScore: r.risk_score,
    vendorChecks: JSON.parse(r.vendor_checks),
    status: r.status,
    assigneeId: r.assignee_id,
    firstApproverId: r.first_approver_id,
    secondApproverId: r.second_approver_id,
    decisionReasonCode: r.decision_reason_code,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const AUDITED_FIELDS: (keyof KycCase)[] = [
  'status',
  'assigneeId',
  'firstApproverId',
  'secondApproverId',
  'decisionReasonCode',
];

function loadRow(db: DB, id: string): CaseRow {
  const row = db.prepare('SELECT * FROM cases WHERE id = ?').get(id) as CaseRow | undefined;
  if (!row) throw new HttpError(404, `Case ${id} not found`);
  return row;
}

function authorize(user: User, action: Action, c?: KycCase): void {
  const d = can(user, action, c);
  if (!d.ok) throw new HttpError(403, d.reason);
}

export const CASE_FILTERS = ['all', 'new', 'mine', 'pending_info', 'escalated', 'second_approval', 'closed'] as const;
export type CaseFilter = (typeof CASE_FILTERS)[number];

export function listCases(db: DB, user: User, filter: CaseFilter = 'all'): KycCase[] {
  const rows = db.prepare('SELECT * FROM cases ORDER BY created_at ASC').all() as CaseRow[];
  return rows
    .map(toCase)
    .filter((c) => can(user, 'case.view', c).ok)
    .filter((c) => {
      switch (filter) {
        case 'all':
          return true;
        case 'new':
          return c.status === 'new';
        case 'mine':
          return c.assigneeId === user.id;
        case 'pending_info':
          return c.status === 'pending_info';
        case 'escalated':
          return c.status === 'escalated';
        case 'second_approval':
          return c.status === 'pending_second_approval';
        case 'closed':
          return c.status === 'approved' || c.status === 'rejected';
      }
    });
}

export function viewCase(db: DB, user: User, id: string, requestId?: string): KycCase {
  return db.transaction(() => {
    const c = toCase(loadRow(db, id));
    authorize(user, 'case.view', c);
    appendAudit(db, { actor: user, action: 'case.viewed', entityType: 'case', entityId: id, requestId });
    return c;
  })();
}

export function revealSsn(db: DB, user: User, id: string, justification: string, requestId?: string): string {
  if (!justification?.trim()) throw new HttpError(400, 'A justification is required to reveal an SSN');
  return db.transaction(() => {
    const row = loadRow(db, id);
    authorize(user, 'case.reveal_ssn', toCase(row));
    appendAudit(db, {
      actor: user,
      action: 'case.ssn_revealed',
      entityType: 'case',
      entityId: id,
      reason: justification.trim(),
      requestId,
    });
    return row.ssn;
  })();
}

export const CASE_ACTIONS = ['claim', 'request_info', 'resume', 'escalate', 'approve', 'reject'] as const;
export type CaseActionName = (typeof CASE_ACTIONS)[number];

export interface ActionInput {
  reasonCode?: string;
  note?: string;
}

type Patch = Partial<Pick<CaseRow, 'status' | 'assignee_id' | 'first_approver_id' | 'second_approver_id' | 'decision_reason_code'>>;

function planPatch(user: User, c: KycCase, action: CaseActionName, input: ActionInput): { patch: Patch; reason: string | null } {
  const note = input.note?.trim() || null;
  const requireNote = () => {
    if (!note) throw new HttpError(400, 'A note is required for this action');
  };
  const requireCode = (codes: Record<string, string>) => {
    if (typeof input.reasonCode !== 'string' || !Object.hasOwn(codes, input.reasonCode)) {
      const verb = action === 'reject' ? 'reject' : 'approve';
      throw new HttpError(400, `Choose a reason code to ${verb}: ${Object.entries(codes).map(([code, label]) => `${label} (${code})`).join(', ')}`);
    }
    return input.reasonCode;
  };
  const withCode = (code: string) => (note ? `${code}: ${note}` : code);

  switch (action) {
    case 'claim':
      return { patch: { status: 'in_review', assignee_id: user.id }, reason: note };
    case 'request_info':
      requireNote();
      return { patch: { status: 'pending_info' }, reason: note };
    case 'resume':
      return { patch: { status: 'in_review' }, reason: note };
    case 'escalate':
      requireNote();
      return { patch: { status: 'escalated', assignee_id: null }, reason: note };
    case 'approve': {
      const code = requireCode(APPROVE_REASON_CODES);
      if (c.status === 'pending_second_approval') {
        return {
          patch: { status: 'approved', second_approver_id: user.id, decision_reason_code: code },
          reason: withCode(code),
        };
      }
      if (c.riskLevel === 'high') {
        return {
          patch: { status: 'pending_second_approval', first_approver_id: user.id, assignee_id: null },
          reason: withCode(code),
        };
      }
      return {
        patch: { status: 'approved', first_approver_id: user.id, decision_reason_code: code },
        reason: withCode(code),
      };
    }
    case 'reject': {
      const code = requireCode(REJECT_REASON_CODES);
      return { patch: { status: 'rejected', decision_reason_code: code }, reason: withCode(code) };
    }
  }
}

/**
 * The single write path for cases: authorize, apply the change, and append the audit
 * event in one transaction, so a change can't be saved without its audit record.
 */
export function performAction(
  db: DB,
  user: User,
  id: string,
  action: CaseActionName,
  input: ActionInput = {},
  requestId?: string,
): KycCase {
  if (!CASE_ACTIONS.includes(action)) throw new HttpError(404, `Unknown action ${action}`);
  return db.transaction(() => {
    const before = toCase(loadRow(db, id));
    authorize(user, `case.${action}` as Action, before);
    const { patch, reason } = planPatch(user, before, action, input);

    const sets = Object.keys(patch).map((k) => `${k} = @${k}`);
    const result = db
      .prepare(`UPDATE cases SET ${sets.join(', ')}, updated_at = @updated_at WHERE id = @id AND status = @expected_status`)
      .run({ ...patch, updated_at: new Date().toISOString(), id, expected_status: before.status });
    if (result.changes !== 1) throw new HttpError(409, 'Case changed concurrently; reload and retry');

    const after = toCase(loadRow(db, id));
    appendAudit(db, {
      actor: user,
      action: `case.${action}`,
      entityType: 'case',
      entityId: id,
      changes: diff(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, AUDITED_FIELDS),
      reason,
      requestId,
    });
    return after;
  })();
}
