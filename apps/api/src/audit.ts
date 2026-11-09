import { createHash } from 'node:crypto';
import type { AuditEvent } from '@kyc/shared';
import type { DB } from './db.js';

export interface Actor {
  id: string;
  role: string;
}

export type Changes = Record<string, { from: unknown; to: unknown }>;

export interface AuditInput {
  actor: Actor;
  action: string;
  entityType: string;
  entityId: string;
  changes?: Changes | null;
  reason?: string | null;
  requestId?: string | null;
}

interface AuditRow {
  id: number;
  at: string;
  actor_id: string;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id: string;
  changes: string | null;
  reason: string | null;
  request_id: string | null;
  prev_hash: string;
  hash: string;
}

const GENESIS = 'GENESIS';

function computeHash(prevHash: string, r: Omit<AuditRow, 'id' | 'prev_hash' | 'hash'>): string {
  const canonical = JSON.stringify([
    r.at,
    r.actor_id,
    r.actor_role,
    r.action,
    r.entity_type,
    r.entity_id,
    r.changes,
    r.reason,
    r.request_id,
  ]);
  return createHash('sha256').update(prevHash).update(canonical).digest('hex');
}

/** Must be called inside the same transaction as the change it records. */
export function appendAudit(db: DB, input: AuditInput): void {
  const prev = db.prepare('SELECT hash FROM audit_events ORDER BY id DESC LIMIT 1').get() as
    | { hash: string }
    | undefined;
  const prevHash = prev?.hash ?? GENESIS;
  const row = {
    at: new Date().toISOString(),
    actor_id: input.actor.id,
    actor_role: input.actor.role,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId,
    changes: input.changes ? JSON.stringify(input.changes) : null,
    reason: input.reason ?? null,
    request_id: input.requestId ?? null,
  };
  db.prepare(
    `INSERT INTO audit_events (at, actor_id, actor_role, action, entity_type, entity_id, changes, reason, request_id, prev_hash, hash)
     VALUES (@at, @actor_id, @actor_role, @action, @entity_type, @entity_id, @changes, @reason, @request_id, @prev_hash, @hash)`,
  ).run({ ...row, prev_hash: prevHash, hash: computeHash(prevHash, row) });
}

export function diff(before: Record<string, unknown>, after: Record<string, unknown>, keys: string[]): Changes {
  const out: Changes = {};
  for (const k of keys) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) out[k] = { from: before[k], to: after[k] };
  }
  return out;
}

function toEvent(r: AuditRow): AuditEvent {
  return {
    id: r.id,
    at: r.at,
    actorId: r.actor_id,
    actorRole: r.actor_role,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    changes: r.changes ? JSON.parse(r.changes) : null,
    reason: r.reason,
    requestId: r.request_id,
    hash: r.hash,
  };
}

export function listAudit(db: DB, filter: { entityType?: string; entityId?: string; limit?: number } = {}): AuditEvent[] {
  const where: string[] = [];
  const params: Record<string, unknown> = { limit: filter.limit ?? 1000 };
  if (filter.entityType) {
    where.push('entity_type = @entityType');
    params.entityType = filter.entityType;
  }
  if (filter.entityId) {
    where.push('entity_id = @entityId');
    params.entityId = filter.entityId;
  }
  const sql = `SELECT * FROM audit_events ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT @limit`;
  return (db.prepare(sql).all(params) as AuditRow[]).map(toEvent);
}

/** Recomputes the hash chain; any edited, inserted or removed row breaks it. */
export function verifyChain(db: DB): { ok: boolean; count: number; brokenAtId: number | null } {
  const rows = db.prepare('SELECT * FROM audit_events ORDER BY id ASC').all() as AuditRow[];
  let prevHash = GENESIS;
  for (const r of rows) {
    if (r.prev_hash !== prevHash || computeHash(prevHash, r) !== r.hash) {
      return { ok: false, count: rows.length, brokenAtId: r.id };
    }
    prevHash = r.hash;
  }
  return { ok: true, count: rows.length, brokenAtId: null };
}

export function toCsv(events: AuditEvent[]): string {
  const header = ['id', 'at', 'actor_id', 'actor_role', 'action', 'entity_type', 'entity_id', 'changes', 'reason', 'request_id', 'hash'];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = events.map((e) =>
    [e.id, e.at, e.actorId, e.actorRole, e.action, e.entityType, e.entityId, e.changes, e.reason, e.requestId, e.hash]
      .map(esc)
      .join(','),
  );
  return [header.join(','), ...lines].join('\n') + '\n';
}
