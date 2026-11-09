import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DB } from '../src/platform/db.js';
import { seed } from '../src/seed.js';
import { buildApp } from '../src/app.js';
import { verifyChain } from '../src/platform/audit.js';

let db: DB;
let app: ReturnType<typeof buildApp>;
const as = (userId: string) => ({ 'x-user-id': userId });
const get = (userId: string, url: string) => app.inject({ method: 'GET', url, headers: as(userId) });
const post = (userId: string, url: string, payload: object = {}) => app.inject({ method: 'POST', url, headers: as(userId), payload });
const put = (userId: string, url: string, payload: object = {}) => app.inject({ method: 'PUT', url, headers: as(userId), payload });
const lastAudit = () => db.prepare('SELECT * FROM audit_events ORDER BY id DESC LIMIT 1').get() as Record<string, string>;

beforeEach(() => {
  db = openDb(':memory:');
  seed(db);
  app = buildApp(db);
});

describe('app catalog and per-app access', () => {
  it('lists every app with the caller’s role, and gates each app’s API by role', async () => {
    const apps = (await get('u-jordan', '/api/apps')).json() as { id: string; myRole: string | null }[];
    expect(apps.find((a) => a.id === 'refunds')?.myRole).toBe('agent');
    expect(apps.find((a) => a.id === 'kyc')?.myRole).toBeNull();
    expect((await get('u-jordan', '/api/kyc/cases')).statusCode).toBe(403);
    expect((await get('u-jordan', '/api/refunds')).statusCode).toBe(200);
    expect((await get('u-alex', '/api/access/people')).statusCode).toBe(403);
    expect((await get('u-avery', '/api/access/people')).statusCode).toBe(200);
  });

  it('serves a summary for each app the caller can open', async () => {
    for (const appId of ['kyc', 'refunds', 'flags', 'audit']) {
      const res = await get('u-taylor', `/api/${appId}/summary`);
      expect(res.statusCode).toBe(200);
      expect(res.json().metrics.length).toBeGreaterThan(0);
    }
  });
});

describe('access admin', () => {
  it('grants, changes and revokes roles with an audit event each, and access follows immediately', async () => {
    expect((await get('u-jordan', '/api/flags')).statusCode).toBe(403);
    const grant = await put('u-avery', '/api/access/people/u-jordan/roles/flags', { role: 'viewer', reason: 'Needs to see launch status' });
    expect(grant.statusCode).toBe(200);
    expect(lastAudit()).toMatchObject({ app_id: 'access', action: 'access.granted', actor_id: 'u-avery', entity_id: 'u-jordan' });
    expect((await get('u-jordan', '/api/flags')).statusCode).toBe(200);

    await put('u-avery', '/api/access/people/u-jordan/roles/flags', { role: 'editor', reason: 'Joined release rotation' });
    expect(JSON.parse(lastAudit().changes)).toEqual({ flags: { from: 'viewer', to: 'editor' } });

    const revoke = await post('u-avery', '/api/access/people/u-jordan/roles/flags/revoke', { reason: 'Rotation ended' });
    expect(revoke.statusCode).toBe(200);
    expect(lastAudit().action).toBe('access.revoked');
    expect((await get('u-jordan', '/api/flags')).statusCode).toBe(403);
    expect(verifyChain(db).ok).toBe(true);
  });

  it('blocks self-service changes, unknown roles and changes without a reason', async () => {
    expect((await put('u-avery', '/api/access/people/u-avery/roles/kyc', { role: 'analyst', reason: 'x' })).statusCode).toBe(403);
    expect((await put('u-avery', '/api/access/people/u-alex/roles/kyc', { role: 'superuser', reason: 'x' })).statusCode).toBe(400);
    expect((await put('u-avery', '/api/access/people/u-alex/roles/kyc', { role: 'senior_reviewer' })).statusCode).toBe(400);
    expect((await put('u-avery', '/api/access/people/u-alex/roles/nope', { role: 'x', reason: 'x' })).statusCode).toBe(404);
  });

  it('adds a person and exports an access review', async () => {
    const res = await post('u-avery', '/api/access/people', { name: 'Robin Vale', title: 'Fraud Analyst' });
    expect(res.statusCode).toBe(200);
    const id = res.json().id;
    expect(lastAudit()).toMatchObject({ action: 'access.person_added', entity_id: id });
    await put('u-avery', `/api/access/people/${id}/roles/kyc`, { role: 'analyst', reason: 'New hire' });
    const csv = (await get('u-avery', '/api/access/review.csv')).body;
    expect(csv.split('\n')[0]).toBe('user_id,name,title,app,role,granted_by,granted_at');
    expect(csv).toContain(`${id},Robin Vale,Fraud Analyst,KYC Review,analyst,u-avery`);
  });
});

describe('refunds', () => {
  const charge = (i = 6) => (db.prepare('SELECT id FROM charges ORDER BY created_at DESC').all() as { id: string }[])[i].id;
  const create = (userId: string, amount: number, c = charge()) =>
    post(userId, '/api/refunds', { chargeId: c, amount, reasonCode: 'goodwill', note: 'test' });

  it('maker-checker: the requester cannot approve their own refund', async () => {
    const r = (await create('u-alex', 5_000)).json();
    expect(r.status).toBe('pending_approval');
    expect(lastAudit()).toMatchObject({ app_id: 'refunds', action: 'refund.requested', actor_id: 'u-alex' });
    expect((await post('u-alex', `/api/refunds/${r.id}/approve`)).statusCode).toBe(403);
    const ok = (await post('u-sam', `/api/refunds/${r.id}/approve`)).json();
    expect(ok.status).toBe('issued');
    expect(ok.processorRefundId).toMatch(/^re_/);
  });

  it('refunds over $1,000 need a second approval from a different finance manager', async () => {
    const r = (await create('u-jordan', 150_000)).json();
    expect((await post('u-sam', `/api/refunds/${r.id}/approve`)).json().status).toBe('pending_second_approval');
    expect((await post('u-sam', `/api/refunds/${r.id}/approve`)).statusCode).toBe(403);
    const done = (await post('u-morgan', `/api/refunds/${r.id}/approve`)).json();
    expect(done).toMatchObject({ status: 'issued', firstApproverId: 'u-sam', secondApproverId: 'u-morgan' });
  });

  it('cannot refund more than what is left on the charge, and rejections need a reason code', async () => {
    const c = charge(13);
    expect((await create('u-jordan', 1_501, c)).statusCode).toBe(400);
    const r = (await create('u-jordan', 1_000, c)).json();
    expect((await create('u-jordan', 600, c)).statusCode).toBe(400);
    expect((await post('u-sam', `/api/refunds/${r.id}/reject`, { reasonCode: 'constructor' })).statusCode).toBe(400);
    expect((await post('u-sam', `/api/refunds/${r.id}/reject`, { reasonCode: 'outside_policy' })).json().status).toBe('rejected');
    expect((await create('u-jordan', 1_500, c)).statusCode).toBe(200);
  });

  it('agents only see their own requests; viewers cannot request', async () => {
    const mine = (await get('u-jordan', '/api/refunds')).json() as { requesterId: string }[];
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => r.requesterId === 'u-jordan')).toBe(true);
    expect((await create('u-taylor', 1_000)).statusCode).toBe(403);
  });

  it('the processor call is idempotent per refund', async () => {
    const { issueProcessorRefund } = await import('../src/apps/refunds/processor.js');
    const a = issueProcessorRefund(db, { chargeId: 'ch_x', amount: 100, idempotencyKey: 'RF-9999' });
    const b = issueProcessorRefund(db, { chargeId: 'ch_x', amount: 100, idempotencyKey: 'RF-9999' });
    expect(a).toBe(b);
  });
});

describe('feature flags', () => {
  it('non-critical changes apply directly; production needs a reason', async () => {
    expect((await post('u-dev', '/api/flags/spending_insights/change', { env: 'prod', enabled: true })).statusCode).toBe(400);
    const res = (await post('u-dev', '/api/flags/spending_insights/change', { env: 'prod', enabled: true, reason: 'Launch' })).json();
    expect(res.applied).toBe(true);
    expect(res.flag.enabled.prod).toBe(true);
    expect(lastAudit()).toMatchObject({ app_id: 'flags', action: 'flag.changed', entity_id: 'spending_insights' });
  });

  it('critical production changes wait for a different release manager', async () => {
    const res = (await post('u-dev', '/api/flags/card_spend_limits_v2/change', { env: 'prod', enabled: true, reason: 'Rollout' })).json();
    expect(res.applied).toBe(false);
    expect(res.flag.enabled.prod).toBe(false);
    const changeId = res.flag.pendingChange.id;
    expect((await post('u-dev', `/api/flags/changes/${changeId}/approve`)).statusCode).toBe(403);
    expect((await post('u-taylor', '/api/flags/card_spend_limits_v2/change', { env: 'dev', enabled: false })).statusCode).toBe(403);
    const approved = (await post('u-priya', `/api/flags/changes/${changeId}/approve`, { note: 'OK' })).json();
    expect(approved.enabled.prod).toBe(true);
    expect(lastAudit()).toMatchObject({ action: 'flag.change_approved', actor_id: 'u-priya' });
  });

  it('a release manager cannot approve their own change', async () => {
    const res = (await post('u-priya', '/api/flags/card_spend_limits_v2/change', { env: 'prod', enabled: true, reason: 'x' })).json();
    expect((await post('u-priya', `/api/flags/changes/${res.flag.pendingChange.id}/approve`)).statusCode).toBe(403);
  });
});

describe('audit center', () => {
  it('filters by app and exports only that app', async () => {
    const refunds = (await get('u-casey', '/api/audit?app=refunds')).json() as { appId: string }[];
    expect(refunds.length).toBeGreaterThan(0);
    expect(refunds.every((e) => e.appId === 'refunds')).toBe(true);
    const csv = (await get('u-casey', '/api/audit/export.csv?app=flags')).body.trim().split('\n').slice(1);
    expect(csv.every((l) => l.split(',')[2] === 'flags')).toBe(true);
    expect((await get('u-jordan', '/api/audit')).statusCode).toBe(403);
  });
});
