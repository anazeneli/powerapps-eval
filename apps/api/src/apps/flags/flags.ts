import {
  ENVIRONMENTS,
  canFlag,
  needsApproval,
  type AppSummary,
  type AppUser,
  type Env,
  type Flag,
  type FlagChange,
  type FlagRole,
} from '@kyc/shared';
import type { DB } from '../../platform/db.js';
import { appendAudit } from '../../platform/audit.js';
import { HttpError } from '../../platform/errors.js';

type FlagUser = AppUser<FlagRole>;

interface FlagRow {
  key: string;
  description: string;
  owner: string;
  critical: number;
  dev: number;
  staging: number;
  prod: number;
  updated_at: string;
}
interface ChangeRow {
  id: number;
  flag_key: string;
  env: Env;
  enabled: number;
  reason: string;
  requested_by: string;
  status: FlagChange['status'];
  decided_by: string | null;
  created_at: string;
  decided_at: string | null;
}

const toChange = (c: ChangeRow): FlagChange => ({
  id: c.id,
  flagKey: c.flag_key,
  env: c.env,
  enabled: !!c.enabled,
  reason: c.reason,
  requestedBy: c.requested_by,
  status: c.status,
  decidedBy: c.decided_by,
  createdAt: c.created_at,
  decidedAt: c.decided_at,
});

export function listFlags(db: DB): Flag[] {
  const pending = new Map(
    (db.prepare("SELECT * FROM flag_changes WHERE status = 'pending'").all() as ChangeRow[]).map((c) => [c.flag_key, toChange(c)]),
  );
  return (db.prepare('SELECT * FROM flags ORDER BY critical DESC, key').all() as FlagRow[]).map((f) => ({
    key: f.key,
    description: f.description,
    owner: f.owner,
    critical: !!f.critical,
    enabled: { dev: !!f.dev, staging: !!f.staging, prod: !!f.prod },
    updatedAt: f.updated_at,
    pendingChange: pending.get(f.key) ?? null,
  }));
}

export function listChanges(db: DB, limit = 50): FlagChange[] {
  return (db.prepare('SELECT * FROM flag_changes ORDER BY id DESC LIMIT ?').all(limit) as ChangeRow[]).map(toChange);
}

function loadFlag(db: DB, key: string): Flag {
  const f = listFlags(db).find((x) => x.key === key);
  if (!f) throw new HttpError(404, `Flag ${key} not found`);
  return f;
}

function apply(db: DB, key: string, env: Env, enabled: boolean) {
  db.prepare(`UPDATE flags SET ${env} = ?, updated_at = ? WHERE key = ?`).run(enabled ? 1 : 0, new Date().toISOString(), key);
}

/** Applies a flag change, or, for production changes to critical flags, files it for approval. Always audited. */
export function changeFlag(
  db: DB,
  user: FlagUser,
  key: string,
  input: { env?: string; enabled?: boolean; reason?: string },
  requestId?: string,
): { applied: boolean; flag: Flag } {
  const d = canFlag(user, 'flag.change');
  if (!d.ok) throw new HttpError(403, d.reason);
  const env = input.env as Env;
  if (!ENVIRONMENTS.includes(env)) throw new HttpError(400, `env must be one of: ${ENVIRONMENTS.join(', ')}`);
  if (typeof input.enabled !== 'boolean') throw new HttpError(400, 'enabled must be true or false');
  const reason = input.reason?.trim() || null;
  if (env === 'prod' && !reason) throw new HttpError(400, 'A reason is required for production changes');

  return db.transaction(() => {
    const flag = loadFlag(db, key);
    if (flag.enabled[env] === input.enabled) throw new HttpError(400, `Already ${input.enabled ? 'on' : 'off'} in ${env}`);
    const changes = { [env]: { from: flag.enabled[env], to: input.enabled } };
    if (needsApproval(flag, env)) {
      if (flag.pendingChange) throw new HttpError(409, 'A production change for this flag is already waiting for approval');
      db.prepare(
        `INSERT INTO flag_changes (flag_key, env, enabled, reason, requested_by, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      ).run(key, env, input.enabled ? 1 : 0, reason, user.id, new Date().toISOString());
      appendAudit(db, { appId: 'flags', actor: user, action: 'flag.change_requested', entityType: 'flag', entityId: key, changes, reason, requestId });
      return { applied: false, flag: loadFlag(db, key) };
    }
    apply(db, key, env, input.enabled as boolean);
    appendAudit(db, { appId: 'flags', actor: user, action: 'flag.changed', entityType: 'flag', entityId: key, changes, reason, requestId });
    return { applied: true, flag: loadFlag(db, key) };
  })();
}

export function decideChange(
  db: DB,
  user: FlagUser,
  changeId: number,
  decision: 'approve' | 'reject',
  note: string | undefined,
  requestId?: string,
): Flag {
  return db.transaction(() => {
    const row = db.prepare('SELECT * FROM flag_changes WHERE id = ?').get(changeId) as ChangeRow | undefined;
    if (!row) throw new HttpError(404, `Change ${changeId} not found`);
    const change = toChange(row);
    const d = canFlag(user, 'flag.decide_change', change);
    if (!d.ok) throw new HttpError(403, d.reason);
    const flag = loadFlag(db, change.flagKey);
    const status = decision === 'approve' ? 'approved' : 'rejected';
    db.prepare("UPDATE flag_changes SET status = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status = 'pending'").run(
      status,
      user.id,
      new Date().toISOString(),
      changeId,
    );
    if (decision === 'approve') apply(db, change.flagKey, change.env, change.enabled);
    appendAudit(db, {
      appId: 'flags',
      actor: user,
      action: `flag.change_${status}`,
      entityType: 'flag',
      entityId: change.flagKey,
      changes: decision === 'approve' ? { [change.env]: { from: flag.enabled[change.env], to: change.enabled } } : null,
      reason: note?.trim() || null,
      requestId,
    });
    return loadFlag(db, change.flagKey);
  })();
}

export function flagsSummary(db: DB): AppSummary {
  const flags = listFlags(db);
  const pending = flags.filter((f) => f.pendingChange).length;
  return {
    metrics: [
      { label: 'Flags', value: flags.length },
      { label: 'On in production', value: flags.filter((f) => f.enabled.prod).length },
      { label: 'Prod changes awaiting approval', value: pending, tone: pending ? 'warning' : 'neutral' },
    ],
  };
}
