import type { FastifyInstance } from 'fastify';
import { APPS, appManifest, type AppId, type AppSummary, type AppUser, type Person } from '@kyc/shared';
import type { DB } from './db.js';
import { requireApp } from './auth.js';
import { HttpError } from './errors.js';
import { appendAudit } from './audit.js';

interface GrantRow {
  user_id: string;
  app_id: AppId;
  role: string;
  granted_by: string;
  granted_at: string;
}

export function listPeople(db: DB): Person[] {
  const users = db.prepare('SELECT id, name, title FROM users ORDER BY name').all() as Omit<Person, 'grants'>[];
  const grants = db.prepare('SELECT * FROM app_roles ORDER BY app_id').all() as GrantRow[];
  return users.map((u) => ({
    ...u,
    grants: grants
      .filter((g) => g.user_id === u.id)
      .map((g) => ({ appId: g.app_id, role: g.role, grantedBy: g.granted_by, grantedAt: g.granted_at })),
  }));
}

export function addPerson(db: DB, actor: AppUser, input: { name?: string; title?: string }, requestId?: string): Person {
  const name = input.name?.trim();
  const title = input.title?.trim();
  if (!name || !title) throw new HttpError(400, 'Name and title are required');
  return db.transaction(() => {
    const base = `u-${name.toLowerCase().split(/\s+/)[0].replace(/[^a-z0-9]/g, '') || 'user'}`;
    let id = base;
    for (let i = 2; db.prepare('SELECT 1 FROM users WHERE id = ?').get(id); i++) id = `${base}${i}`;
    db.prepare('INSERT INTO users (id, name, title, created_at) VALUES (?, ?, ?, ?)').run(id, name, title, new Date().toISOString());
    appendAudit(db, {
      appId: 'access',
      actor,
      action: 'access.person_added',
      entityType: 'user',
      entityId: id,
      changes: { name: { from: null, to: name }, title: { from: null, to: title } },
      requestId,
    });
    return { id, name, title, grants: [] };
  })();
}

/** Grants, changes or (role = null) revokes one app role. Audited; admins cannot change their own access. */
export function setRole(
  db: DB,
  actor: AppUser,
  userId: string,
  appId: string,
  role: string | null,
  reason: string | undefined,
  requestId?: string,
): Person {
  const app = appManifest(appId);
  if (!app) throw new HttpError(404, `Unknown app ${appId}`);
  if (role !== null && !app.roles.some((r) => r.id === role)) {
    throw new HttpError(400, `Role must be one of: ${app.roles.map((r) => r.id).join(', ')}`);
  }
  if (!reason?.trim()) throw new HttpError(400, 'A reason is required for access changes');
  if (userId === actor.id) throw new HttpError(403, 'You cannot change your own access; ask another access admin');

  return db.transaction(() => {
    if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) throw new HttpError(404, `Person ${userId} not found`);
    const current = (db.prepare('SELECT role FROM app_roles WHERE user_id = ? AND app_id = ?').get(userId, appId) as { role: string } | undefined)?.role ?? null;
    if (current === role) throw new HttpError(400, 'No change');
    if (role === null) {
      db.prepare('DELETE FROM app_roles WHERE user_id = ? AND app_id = ?').run(userId, appId);
    } else {
      db.prepare(
        `INSERT INTO app_roles (user_id, app_id, role, granted_by, granted_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, app_id) DO UPDATE SET role = excluded.role, granted_by = excluded.granted_by, granted_at = excluded.granted_at`,
      ).run(userId, appId, role, actor.id, new Date().toISOString());
    }
    appendAudit(db, {
      appId: 'access',
      actor,
      action: role === null ? 'access.revoked' : current === null ? 'access.granted' : 'access.changed',
      entityType: 'user',
      entityId: userId,
      changes: { [appId]: { from: current, to: role } },
      reason: reason.trim(),
      requestId,
    });
    return listPeople(db).find((p) => p.id === userId)!;
  })();
}

export function accessReviewCsv(db: DB): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = listPeople(db).flatMap((p) =>
    p.grants.map((g) => [p.id, p.name, p.title, appManifest(g.appId)?.name ?? g.appId, g.role, g.grantedBy, g.grantedAt].map(esc).join(',')),
  );
  return ['user_id,name,title,app,role,granted_by,granted_at', ...lines].join('\n') + '\n';
}

export const accessRoutes = (db: DB) => async (app: FastifyInstance) => {
  requireApp(app, 'access');

  app.get('/people', async () => listPeople(db));
  app.get('/apps', async () => APPS);
  app.post<{ Body: { name?: string; title?: string } }>('/people', async (req) => addPerson(db, req.appUser, req.body ?? {}, req.id));
  app.put<{ Params: { id: string; appId: string }; Body: { role?: string; reason?: string } }>('/people/:id/roles/:appId', async (req) =>
    setRole(db, req.appUser, req.params.id, req.params.appId, req.body?.role ?? '', req.body?.reason, req.id),
  );
  app.post<{ Params: { id: string; appId: string }; Body: { reason?: string } }>('/people/:id/roles/:appId/revoke', async (req) =>
    setRole(db, req.appUser, req.params.id, req.params.appId, null, req.body?.reason, req.id),
  );
  app.get('/review.csv', async (_req, reply) =>
    reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="access-review.csv"')
      .send(accessReviewCsv(db)),
  );
  app.get('/summary', async (): Promise<AppSummary> => {
    const people = listPeople(db);
    const { c } = db
      .prepare("SELECT COUNT(*) AS c FROM audit_events WHERE app_id = 'access' AND at >= ?")
      .get(new Date(Date.now() - 7 * 86_400_000).toISOString()) as { c: number };
    return {
      metrics: [
        { label: 'People', value: people.length },
        { label: 'Role grants', value: people.reduce((n, p) => n + p.grants.length, 0) },
        { label: 'Access changes (7d)', value: c },
      ],
    };
  });
};
