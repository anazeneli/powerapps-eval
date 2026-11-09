import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DB } from '../src/db.js';
import { seed } from '../src/seed.js';
import { buildApp } from '../src/app.js';
import { verifyChain } from '../src/audit.js';

let db: DB;
let app: ReturnType<typeof buildApp>;

const as = (userId: string) => ({ 'x-user-id': userId });

function caseIdWhere(where: string): string {
  const row = db.prepare(`SELECT id FROM cases WHERE ${where} ORDER BY id LIMIT 1`).get() as { id: string } | undefined;
  if (!row) throw new Error(`no case where ${where}`);
  return row.id;
}

function auditFor(id: string) {
  return db.prepare("SELECT * FROM audit_events WHERE entity_id = ? ORDER BY id").all(id) as Record<string, string>[];
}

async function action(userId: string, id: string, name: string, body: object = {}) {
  return app.inject({ method: 'POST', url: `/api/cases/${id}/actions/${name}`, headers: as(userId), payload: body });
}

beforeEach(() => {
  db = openDb(':memory:');
  seed(db);
  app = buildApp(db);
});

describe('authentication and row-level access', () => {
  it('rejects requests without a known user', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/cases' });
    expect(res.statusCode).toBe(401);
  });

  it('analysts only see unassigned new cases and their own', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/cases', headers: as('u-alex') });
    const cases = res.json() as { status: string; assigneeId: string | null }[];
    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases) expect(c.assigneeId === 'u-alex' || (c.status === 'new' && c.assigneeId === null)).toBe(true);

    const beasCase = caseIdWhere("assignee_id = 'u-bea'");
    const denied = await app.inject({ method: 'GET', url: `/api/cases/${beasCase}`, headers: as('u-alex') });
    expect(denied.statusCode).toBe(403);
  });

  it('only compliance admins can read the full audit log', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/audit', headers: as('u-sam') })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/audit', headers: as('u-casey') })).statusCode).toBe(200);
  });

  it('compliance admins are read-only on cases', async () => {
    const id = caseIdWhere("status = 'new'");
    expect((await action('u-casey', id, 'claim')).statusCode).toBe(403);
  });
});

describe('audit trail', () => {
  it('writes an audit event with actor, changes and request id in the same transaction as the change', async () => {
    const id = caseIdWhere("status = 'new'");
    const res = await action('u-alex', id, 'claim');
    expect(res.statusCode).toBe(200);
    const last = auditFor(id).at(-1)!;
    expect(last.action).toBe('case.claim');
    expect(last.actor_id).toBe('u-alex');
    expect(last.request_id).toBeTruthy();
    expect(JSON.parse(last.changes)).toEqual({
      status: { from: 'new', to: 'in_review' },
      assigneeId: { from: null, to: 'u-alex' },
    });
  });

  it('a rejected action changes nothing and writes nothing', async () => {
    const id = caseIdWhere("status = 'new'");
    const before = auditFor(id).length;
    const res = await action('u-alex', id, 'approve', { reasonCode: 'docs_verified' });
    expect(res.statusCode).toBe(403);
    expect(auditFor(id).length).toBe(before);
    expect((db.prepare('SELECT status FROM cases WHERE id = ?').get(id) as { status: string }).status).toBe('new');
  });

  it('the database refuses to update or delete audit events', () => {
    expect(() => db.prepare("UPDATE audit_events SET reason = 'edited'").run()).toThrow(/append-only/);
    expect(() => db.prepare('DELETE FROM audit_events').run()).toThrow(/append-only/);
  });

  it('the hash chain verifies, and detects tampering', async () => {
    expect(verifyChain(db).ok).toBe(true);
    db.exec('DROP TRIGGER audit_events_no_update');
    db.prepare("UPDATE audit_events SET actor_id = 'u-mallory' WHERE id = 5").run();
    expect(verifyChain(db)).toMatchObject({ ok: false, brokenAtId: 5 });
  });

  it('logs case views', async () => {
    const id = caseIdWhere("status = 'new'");
    await app.inject({ method: 'GET', url: `/api/cases/${id}`, headers: as('u-sam') });
    expect(auditFor(id).at(-1)).toMatchObject({ action: 'case.viewed', actor_id: 'u-sam' });
  });
});

describe('decisions and four-eyes approval', () => {
  it('requires a valid reason code to approve or reject', async () => {
    const id = caseIdWhere("status = 'new' AND risk_level = 'low'");
    await action('u-alex', id, 'claim');
    const missing = await action('u-alex', id, 'approve');
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error).toBe(
      'Choose a reason code to approve: Documents verified (docs_verified), Manual identity match confirmed (manual_match_confirmed), Watchlist hit is a false positive (watchlist_false_positive)',
    );
    expect((await action('u-alex', id, 'approve', { reasonCode: 'document_fraud' })).statusCode).toBe(400);
    expect((await action('u-alex', id, 'approve', { reasonCode: 'docs_verified' })).json().status).toBe('approved');
  });

  it('high-risk approvals need a second, different senior reviewer', async () => {
    const id = caseIdWhere("status = 'new' AND risk_level = 'high'");
    await action('u-sam', id, 'claim');
    const first = await action('u-sam', id, 'approve', { reasonCode: 'docs_verified' });
    expect(first.json()).toMatchObject({ status: 'pending_second_approval', firstApproverId: 'u-sam' });

    const self = await action('u-sam', id, 'approve', { reasonCode: 'docs_verified' });
    expect(self.statusCode).toBe(403);
    expect(self.json().error).toMatch(/first approver/);

    expect((await action('u-alex', id, 'approve', { reasonCode: 'docs_verified' })).statusCode).toBe(403);

    const second = await action('u-riley', id, 'approve', { reasonCode: 'docs_verified' });
    expect(second.json()).toMatchObject({ status: 'approved', firstApproverId: 'u-sam', secondApproverId: 'u-riley' });
  });

  it('the database also refuses a second approval by the first approver', () => {
    const id = caseIdWhere("status = 'pending_second_approval'");
    const { first_approver_id } = db.prepare('SELECT first_approver_id FROM cases WHERE id = ?').get(id) as {
      first_approver_id: string;
    };
    expect(() =>
      db.prepare('UPDATE cases SET second_approver_id = ? WHERE id = ?').run(first_approver_id, id),
    ).toThrow(/CHECK constraint/);
  });

  it('escalated cases can only be picked up by senior reviewers', async () => {
    const id = caseIdWhere("status = 'escalated'");
    expect((await action('u-alex', id, 'claim')).statusCode).toBe(403);
    expect((await action('u-sam', id, 'claim')).json().status).toBe('in_review');
  });
});

describe('SSN masking', () => {
  it('returns masked SSNs and logs reveals with a justification', async () => {
    const id = caseIdWhere("status = 'new'");
    const { ssn } = db.prepare('SELECT ssn FROM cases WHERE id = ?').get(id) as { ssn: string };

    const detail = await app.inject({ method: 'GET', url: `/api/cases/${id}`, headers: as('u-sam') });
    expect(detail.body).not.toContain(ssn);
    expect(detail.json().ssnMasked).toBe(`***-**-${ssn.slice(-4)}`);

    const noReason = await app.inject({ method: 'POST', url: `/api/cases/${id}/reveal-ssn`, headers: as('u-sam'), payload: {} });
    expect(noReason.statusCode).toBe(400);

    const ok = await app.inject({
      method: 'POST',
      url: `/api/cases/${id}/reveal-ssn`,
      headers: as('u-sam'),
      payload: { justification: 'Compare with document' },
    });
    expect(ok.json().ssn).toBe(ssn);
    expect(auditFor(id).at(-1)).toMatchObject({ action: 'case.ssn_revealed', actor_id: 'u-sam', reason: 'Compare with document' });
  });

  it('analysts cannot reveal SSNs on cases not assigned to them', async () => {
    const id = caseIdWhere("status = 'new'");
    const res = await app.inject({ method: 'POST', url: `/api/cases/${id}/reveal-ssn`, headers: as('u-alex'), payload: { justification: 'x' } });
    expect(res.statusCode).toBe(403);
  });

  it('never writes the raw SSN into the audit log', async () => {
    const csv = await app.inject({ method: 'GET', url: '/api/audit.csv', headers: as('u-casey') });
    const ssns = (db.prepare('SELECT ssn FROM cases').all() as { ssn: string }[]).map((r) => r.ssn);
    for (const s of ssns) expect(csv.body).not.toContain(s);
  });
});

describe('dashboard stats', () => {
  const stats = async (userId: string) => (await app.inject({ method: 'GET', url: '/api/stats', headers: as(userId) })).json();

  it('scopes numbers to the cases the caller can view', async () => {
    const all = await stats('u-sam');
    const alex = await stats('u-alex');
    const visible = (await app.inject({ method: 'GET', url: '/api/cases', headers: as('u-alex') })).json() as unknown[];
    expect(all.scope).toBe('all');
    expect(Object.values(all.byStatus as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(50);
    expect(alex.scope).toBe('visible');
    expect(Object.values(alex.byStatus as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(visible.length);
  });

  it('counts decisions, four-eyes approvals and reveals', async () => {
    const id = caseIdWhere("status = 'new' AND risk_level = 'high'");
    await action('u-alex', id, 'claim');
    await app.inject({ method: 'POST', url: `/api/cases/${id}/reveal-ssn`, headers: as('u-alex'), payload: { justification: 'Check' } });
    await action('u-alex', id, 'approve', { reasonCode: 'docs_verified' });
    const before = await stats('u-casey');
    await action('u-sam', id, 'approve', { reasonCode: 'docs_verified' });
    const after = await stats('u-casey');
    expect(after.decided7d).toBe(before.decided7d + 1);
    expect(after.fourEyesApprovals).toBe(before.fourEyesApprovals + 1);
    expect(after.awaitingSecond).toBe(before.awaitingSecond - 1);
    expect(after.ssnReveals7d).toBeGreaterThanOrEqual(1);
    expect(after.decisionsByDay).toHaveLength(7);
  });

  it('returns no customer data and writes no audit events', async () => {
    const count = () => (db.prepare('SELECT COUNT(*) AS n FROM audit_events').get() as { n: number }).n;
    const n = count();
    const body = JSON.stringify(await stats('u-sam'));
    expect(count()).toBe(n);
    expect(body).not.toMatch(/\d{3}-\d{2}-\d{4}|customerName|ssn"/);
  });
});
