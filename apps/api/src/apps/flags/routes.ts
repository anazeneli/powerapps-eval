import type { FastifyInstance } from 'fastify';
import type { AppUser, FlagRole } from '@kyc/shared';
import type { DB } from '../../platform/db.js';
import { requireApp } from '../../platform/auth.js';
import { HttpError } from '../../platform/errors.js';
import { listAudit } from '../../platform/audit.js';
import { changeFlag, decideChange, flagsSummary, listChanges, listFlags } from './flags.js';

export const flagRoutes = (db: DB) => async (app: FastifyInstance) => {
  requireApp(app, 'flags');
  const me = (req: { appUser: unknown }) => req.appUser as AppUser<FlagRole>;

  app.get('/', async () => listFlags(db));
  app.get('/changes', async () => listChanges(db));
  app.get('/summary', async () => flagsSummary(db));
  app.get<{ Params: { key: string } }>('/:key/audit', async (req) => listAudit(db, { appId: 'flags', entityType: 'flag', entityId: req.params.key }));
  app.post<{ Params: { key: string }; Body: { env?: string; enabled?: boolean; reason?: string } }>('/:key/change', async (req) =>
    changeFlag(db, me(req), req.params.key, req.body ?? {}, req.id),
  );
  app.post<{ Params: { id: string; decision: string }; Body: { note?: string } }>('/changes/:id/:decision', async (req) => {
    const d = req.params.decision;
    if (d !== 'approve' && d !== 'reject') throw new HttpError(404, `Unknown action ${d}`);
    return decideChange(db, me(req), Number(req.params.id), d, req.body?.note, req.id);
  });
};
