import type { FastifyInstance } from 'fastify';
import { APPS, type AppSummary, type CatalogEntry } from '@kyc/shared';
import type { DB } from './db.js';
import { loadUser, requireApp } from './auth.js';
import { HttpError } from './errors.js';
import { listAudit, toCsv, verifyChain } from './audit.js';

export const platformRoutes = (db: DB) => async (app: FastifyInstance) => {
  app.get('/api/health', async () => ({ ok: true }));

  // Mock sign-in directory for the user switcher. In production, Entra ID replaces this.
  app.get('/api/users', async () => {
    const ids = db.prepare('SELECT id FROM users ORDER BY name').all() as { id: string }[];
    return ids.map(({ id }) => loadUser(db, id));
  });

  app.get('/api/me', async (req) => req.user);

  app.get('/api/apps', async (req): Promise<CatalogEntry[]> => APPS.map((a) => ({ ...a, myRole: req.user.roles[a.id] ?? null })));
};

export const auditRoutes = (db: DB) => async (app: FastifyInstance) => {
  requireApp(app, 'audit');

  app.get<{ Querystring: { app?: string; limit?: string } }>('/', async (req) =>
    listAudit(db, { appId: req.query.app || undefined, limit: Number(req.query.limit ?? 500) }),
  );

  app.get('/verify', async () => verifyChain(db));

  app.get<{ Querystring: { app?: string } }>('/export.csv', async (req, reply) =>
    reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="audit-log.csv"')
      .send(toCsv(listAudit(db, { appId: req.query.app || undefined, order: 'asc' }))),
  );

  app.get('/summary', async (): Promise<AppSummary> => {
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM audit_events').get() as { n: number };
    const { d } = db
      .prepare('SELECT COUNT(*) AS d FROM audit_events WHERE at >= ?')
      .get(new Date(Date.now() - 86_400_000).toISOString()) as { d: number };
    const chain = verifyChain(db);
    return {
      metrics: [
        { label: 'Events (24h)', value: d },
        { label: 'Hash chain', value: chain.ok ? 'Intact' : 'Broken', tone: chain.ok ? 'success' : 'danger' },
        { label: 'Total events', value: n },
      ],
    };
  });

};
