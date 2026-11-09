import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyRequest } from 'fastify';
import { can, type Role, type User } from '@kyc/shared';
import type { DB } from './db.js';
import { listAudit, toCsv, verifyChain } from './audit.js';
import { kycStats } from './stats.js';
import {
  CASE_ACTIONS,
  CASE_FILTERS,
  HttpError,
  listCases,
  performAction,
  revealSsn,
  viewCase,
  type ActionInput,
  type CaseActionName,
  type CaseFilter,
} from './kyc.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: User;
  }
}

export function buildApp(db: DB, opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? false, genReqId: () => randomUUID() });

  const findUser = db.prepare('SELECT id, name, role FROM users WHERE id = ?');

  // Mock authentication: the UI's user switcher sends x-user-id. In production this is an
  // Entra ID access token validated here, with app roles mapped to Role.
  app.addHook('preHandler', async (req) => {
    if (req.url === '/api/users' || req.url === '/api/health') return;
    const id = req.headers['x-user-id'];
    const user = typeof id === 'string' ? (findUser.get(id) as { id: string; name: string; role: Role } | undefined) : undefined;
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

  const requireAuditAccess = (req: FastifyRequest) => {
    const d = can(req.user, 'audit.view_all');
    if (!d.ok) throw new HttpError(403, d.reason);
  };

  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/users', async () => db.prepare('SELECT id, name, role FROM users ORDER BY role, name').all());

  app.get('/api/me', async (req) => req.user);

  app.get<{ Querystring: { filter?: string } }>('/api/cases', async (req) => {
    const filter = (req.query.filter ?? 'all') as CaseFilter;
    if (!CASE_FILTERS.includes(filter)) throw new HttpError(400, `filter must be one of: ${CASE_FILTERS.join(', ')}`);
    return listCases(db, req.user, filter);
  });

  app.get('/api/stats', async (req) => kycStats(db, req.user));

  app.get<{ Params: { id: string } }>('/api/cases/:id', async (req) => viewCase(db, req.user, req.params.id, req.id));

  app.post<{ Params: { id: string }; Body: { justification?: string } }>('/api/cases/:id/reveal-ssn', async (req) => ({
    ssn: revealSsn(db, req.user, req.params.id, req.body?.justification ?? '', req.id),
  }));

  app.post<{ Params: { id: string; action: string }; Body: ActionInput }>('/api/cases/:id/actions/:action', async (req) => {
    const action = req.params.action as CaseActionName;
    if (!CASE_ACTIONS.includes(action)) throw new HttpError(404, `Unknown action ${req.params.action}`);
    return performAction(db, req.user, req.params.id, action, req.body ?? {}, req.id);
  });

  app.get<{ Params: { id: string } }>('/api/cases/:id/audit', async (req) => {
    viewableOrThrow(req.user, req.params.id);
    return listAudit(db, { entityType: 'case', entityId: req.params.id });
  });

  app.get<{ Querystring: { limit?: string; action?: string; since?: string } }>('/api/audit', async (req) => {
    requireAuditAccess(req);
    const { action, since } = req.query;
    // A filtered query (e.g. a dashboard drill-down) returns every match; the unfiltered log is paged.
    return listAudit(db, { action, since, limit: action || since ? undefined : Number(req.query.limit ?? 500) });
  });

  app.get('/api/audit/verify', async (req) => {
    requireAuditAccess(req);
    return verifyChain(db);
  });

  app.get('/api/audit.csv', async (req, reply) => {
    requireAuditAccess(req);
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="audit-log.csv"')
      .send(toCsv(listAudit(db, { order: 'asc' })));
  });

  function viewableOrThrow(user: User, id: string) {
    const row = db.prepare('SELECT status, assignee_id, first_approver_id FROM cases WHERE id = ?').get(id) as
      | { status: string; assignee_id: string | null; first_approver_id: string | null }
      | undefined;
    if (!row) throw new HttpError(404, `Case ${id} not found`);
    const d = can(user, 'case.view', {
      status: row.status as never,
      assigneeId: row.assignee_id,
      firstApproverId: row.first_approver_id,
    });
    if (!d.ok) throw new HttpError(403, d.reason);
  }

  return app;
}
