import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import type { DB } from './platform/db.js';
import { HttpError } from './platform/errors.js';
import { loadUser } from './platform/auth.js';
import { auditRoutes, platformRoutes } from './platform/routes.js';
import { accessRoutes } from './platform/access.js';
import { kycRoutes } from './apps/kyc/routes.js';
import { refundRoutes } from './apps/refunds/routes.js';
import { flagRoutes } from './apps/flags/routes.js';

export function buildApp(db: DB, opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? false, genReqId: () => randomUUID() });

  // Mock authentication: the UI's user switcher sends x-user-id. In production this is an
  // Entra ID access token validated here, with Entra groups or app roles mapped to app_roles.
  app.addHook('preHandler', async (req) => {
    const path = req.url.split('?')[0];
    if (path === '/api/users' || path === '/api/health') return;
    const id = req.headers['x-user-id'];
    const user = typeof id === 'string' ? loadUser(db, id) : undefined;
    if (!user) throw new HttpError(401, 'Unknown or missing user (x-user-id)');
    req.user = user;
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.status(status).send({ error: (err as Error).message });
    app.log.error(err);
    return reply.status(500).send({ error: 'Internal error' });
  });

  app.register(platformRoutes(db));
  app.register(auditRoutes(db), { prefix: '/api/audit' });
  app.register(accessRoutes(db), { prefix: '/api/access' });
  app.register(kycRoutes(db), { prefix: '/api/kyc' });
  app.register(refundRoutes(db), { prefix: '/api/refunds' });
  app.register(flagRoutes(db), { prefix: '/api/flags' });

  return app;
}
