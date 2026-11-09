import type { FastifyInstance } from 'fastify';
import type { AppSummary, User } from '@kyc/shared';
import type { DB } from '../../platform/db.js';
import { requireApp } from '../../platform/auth.js';
import { HttpError } from '../../platform/errors.js';
import { listAudit } from '../../platform/audit.js';
import { can } from '@kyc/shared';
import {
  CASE_ACTIONS,
  CASE_FILTERS,
  listCases,
  performAction,
  revealSsn,
  viewCase,
  type ActionInput,
  type CaseActionName,
  type CaseFilter,
} from './kyc.js';
import { kycStats } from './stats.js';

export const kycRoutes = (db: DB) => async (app: FastifyInstance) => {
  requireApp(app, 'kyc');
  const me = (req: { appUser: unknown }) => req.appUser as User;

  app.get<{ Querystring: { filter?: string } }>('/cases', async (req) => {
    const filter = (req.query.filter ?? 'all') as CaseFilter;
    if (!CASE_FILTERS.includes(filter)) throw new HttpError(400, `filter must be one of: ${CASE_FILTERS.join(', ')}`);
    return listCases(db, me(req), filter);
  });

  app.get('/stats', async (req) => kycStats(db, me(req)));

  app.get('/summary', async (req): Promise<AppSummary> => {
    const s = kycStats(db, me(req));
    return {
      metrics: [
        { label: 'Open cases', value: s.open },
        { label: 'SLA breaches', value: s.slaBreaches, tone: s.slaBreaches ? 'danger' : 'success' },
        { label: 'Awaiting 2nd approval', value: s.awaitingSecond, tone: s.awaitingSecond ? 'warning' : 'neutral' },
      ],
    };
  });

  app.get<{ Params: { id: string } }>('/cases/:id', async (req) => viewCase(db, me(req), req.params.id, req.id));

  app.post<{ Params: { id: string }; Body: { justification?: string } }>('/cases/:id/reveal-ssn', async (req) => ({
    ssn: revealSsn(db, me(req), req.params.id, req.body?.justification ?? '', req.id),
  }));

  app.post<{ Params: { id: string; action: string }; Body: ActionInput }>('/cases/:id/actions/:action', async (req) => {
    const action = req.params.action as CaseActionName;
    if (!CASE_ACTIONS.includes(action)) throw new HttpError(404, `Unknown action ${req.params.action}`);
    return performAction(db, me(req), req.params.id, action, req.body ?? {}, req.id);
  });

  app.get<{ Params: { id: string } }>('/cases/:id/audit', async (req) => {
    const row = db.prepare('SELECT status, assignee_id, first_approver_id FROM cases WHERE id = ?').get(req.params.id) as
      | { status: string; assignee_id: string | null; first_approver_id: string | null }
      | undefined;
    if (!row) throw new HttpError(404, `Case ${req.params.id} not found`);
    const d = can(me(req), 'case.view', { status: row.status as never, assigneeId: row.assignee_id, firstApproverId: row.first_approver_id });
    if (!d.ok) throw new HttpError(403, d.reason);
    return listAudit(db, { appId: 'kyc', entityType: 'case', entityId: req.params.id });
  });
};
