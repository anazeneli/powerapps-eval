import type { FastifyInstance } from 'fastify';
import { appManifest, type AppId, type AppUser, type PlatformUser } from '@kyc/shared';
import type { DB } from './db.js';
import { HttpError } from './errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: PlatformUser;
    appUser: AppUser;
  }
}

export function loadUser(db: DB, id: string): PlatformUser | undefined {
  const u = db.prepare('SELECT id, name, title FROM users WHERE id = ?').get(id) as Omit<PlatformUser, 'roles'> | undefined;
  if (!u) return undefined;
  const rows = db.prepare('SELECT app_id, role FROM app_roles WHERE user_id = ?').all(id) as { app_id: AppId; role: string }[];
  return { ...u, roles: Object.fromEntries(rows.map((r) => [r.app_id, r.role])) };
}

export function asAppUser(db: DB, id: string, appId: AppId): AppUser {
  const u = loadUser(db, id);
  const role = u?.roles[appId];
  if (!u || !role) throw new HttpError(403, `${id} has no role in ${appId}`);
  return { id: u.id, name: u.name, role };
}

/** Scopes a route plugin to one app: callers need a role in that app, and handlers get req.appUser. */
export function requireApp(app: FastifyInstance, appId: AppId): void {
  app.addHook('preHandler', async (req) => {
    const role = req.user.roles[appId];
    if (!role) throw new HttpError(403, `You don't have access to ${appManifest(appId)?.name ?? appId}`);
    req.appUser = { id: req.user.id, name: req.user.name, role };
  });
}
