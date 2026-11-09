import type { FastifyInstance } from 'fastify';
import type { AppUser, RefundRole } from '@kyc/shared';
import type { DB } from '../../platform/db.js';
import { requireApp } from '../../platform/auth.js';
import { HttpError } from '../../platform/errors.js';
import { listAudit } from '../../platform/audit.js';
import {
  REFUND_FILTERS,
  createRefund,
  decideRefund,
  getRefund,
  listCharges,
  listRefunds,
  refundsSummary,
  type CreateRefundInput,
  type RefundFilter,
} from './refunds.js';

export const refundRoutes = (db: DB) => async (app: FastifyInstance) => {
  requireApp(app, 'refunds');
  const me = (req: { appUser: unknown }) => req.appUser as AppUser<RefundRole>;

  app.get<{ Querystring: { filter?: string } }>('/', async (req) => {
    const filter = (req.query.filter ?? 'all') as RefundFilter;
    if (!REFUND_FILTERS.includes(filter)) throw new HttpError(400, `filter must be one of: ${REFUND_FILTERS.join(', ')}`);
    return listRefunds(db, me(req), filter);
  });
  app.get('/charges', async () => listCharges(db));
  app.get('/summary', async (req) => refundsSummary(db, me(req)));
  app.post<{ Body: CreateRefundInput }>('/', async (req) => createRefund(db, me(req), req.body ?? {}, req.id));
  app.get<{ Params: { id: string } }>('/:id', async (req) => getRefund(db, me(req), req.params.id));
  app.get<{ Params: { id: string } }>('/:id/audit', async (req) => {
    getRefund(db, me(req), req.params.id);
    return listAudit(db, { appId: 'refunds', entityType: 'refund', entityId: req.params.id });
  });
  app.post<{ Params: { id: string; decision: string }; Body: { reasonCode?: string; note?: string } }>('/:id/:decision', async (req) => {
    const d = req.params.decision;
    if (d !== 'approve' && d !== 'reject') throw new HttpError(404, `Unknown action ${d}`);
    return decideRefund(db, me(req), req.params.id, d, req.body ?? {}, req.id);
  });
};
