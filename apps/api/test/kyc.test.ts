import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DB } from '../src/platform/db.js';
import { seed } from '../src/seed.js';
import { buildApp } from '../src/app.js';
import { verifyChain } from '../src/platform/audit.js';
import { can, type KycCase, type User } from '@kyc/shared';
import { PEOPLE } from '../src/seed.js';

const USERS: User[] = PEOPLE.filter((p) => p.roles.kyc).map((p) => ({ id: p.id, name: p.name, role: p.roles.kyc as User['role'] }));
import { APPROVE_REASON_CODES } from '@kyc/shared';

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
  return app.inject({ method: 'POST', url: `/api/kyc/cases/${id}/actions/${name}`, headers: as(userId), payload: body });
}

beforeEach(() => {
  db = openDb(':memory:');
  seed(db);
  app = buildApp(db);
});

describe('authentication and row-level access', () => {
  it('rejects requests without a known user', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/kyc/cases' });
    expect(res.statusCode).toBe(401);
  });

  it('analysts only see unassigned new cases and their own', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/kyc/cases', headers: as('u-alex') });
    const cases = res.json() as { status: string; assigneeId: string | null }[];
    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases) expect(c.assigneeId === 'u-alex' || (c.status === 'new' && c.assigneeId === null)).toBe(true);

    const beasCase = caseIdWhere("assignee_id = 'u-bea'");
    const denied = await app.inject({ method: 'GET', url: `/api/kyc/cases/${beasCase}`, headers: as('u-alex') });
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
    await app.inject({ method: 'GET', url: `/api/kyc/cases/${id}`, headers: as('u-sam') });
    expect(auditFor(id).at(-1)).toMatchObject({ action: 'case.viewed', actor_id: 'u-sam' });
  });
});

describe('decisions and four-eyes approval', () => {
  it('requires a valid reason code to approve or reject', async () => {
    const id = caseIdWhere("status = 'new' AND risk_level = 'low'");
    await action('u-alex', id, 'claim');
    const missing = await action('u-alex', id, 'approve');
    expect(missing.statusCode).toBe(400);
    const message: string = missing.json().error;
    expect(message).toMatch(/approve/i);
    for (const code of Object.keys(APPROVE_REASON_CODES)) expect(message).toContain(code);
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

    const detail = await app.inject({ method: 'GET', url: `/api/kyc/cases/${id}`, headers: as('u-sam') });
    expect(detail.body).not.toContain(ssn);
    expect(detail.json().ssnMasked).toBe(`***-**-${ssn.slice(-4)}`);

    const noReason = await app.inject({ method: 'POST', url: `/api/kyc/cases/${id}/reveal-ssn`, headers: as('u-sam'), payload: {} });
    expect(noReason.statusCode).toBe(400);

    const ok = await app.inject({
      method: 'POST',
      url: `/api/kyc/cases/${id}/reveal-ssn`,
      headers: as('u-sam'),
      payload: { justification: 'Compare with document' },
    });
    expect(ok.json().ssn).toBe(ssn);
    expect(auditFor(id).at(-1)).toMatchObject({ action: 'case.ssn_revealed', actor_id: 'u-sam', reason: 'Compare with document' });
  });

  it('analysts cannot reveal SSNs on cases not assigned to them', async () => {
    const id = caseIdWhere("status = 'new'");
    const res = await app.inject({ method: 'POST', url: `/api/kyc/cases/${id}/reveal-ssn`, headers: as('u-alex'), payload: { justification: 'x' } });
    expect(res.statusCode).toBe(403);
  });

  it('never writes the raw SSN into the audit log', async () => {
    const csv = await app.inject({ method: 'GET', url: '/api/audit/export.csv', headers: as('u-casey') });
    const ssns = (db.prepare('SELECT ssn FROM cases').all() as { ssn: string }[]).map((r) => r.ssn);
    for (const s of ssns) expect(csv.body).not.toContain(s);
  });
});

describe('dashboard stats', () => {
  const stats = async (userId: string) => (await app.inject({ method: 'GET', url: '/api/kyc/stats', headers: as(userId) })).json();

  it('scopes numbers to the cases the caller can view', async () => {
    const all = await stats('u-sam');
    const alex = await stats('u-alex');
    const visible = (await app.inject({ method: 'GET', url: '/api/kyc/cases', headers: as('u-alex') })).json() as unknown[];
    expect(all.scope).toBe('all');
    expect(Object.values(all.byStatus as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(50);
    expect(alex.scope).toBe('visible');
    expect(Object.values(alex.byStatus as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(visible.length);
  });

  it('counts decisions, four-eyes approvals and reveals', async () => {
    const id = caseIdWhere("status = 'new' AND risk_level = 'high'");
    await action('u-alex', id, 'claim');
    await app.inject({ method: 'POST', url: `/api/kyc/cases/${id}/reveal-ssn`, headers: as('u-alex'), payload: { justification: 'Check' } });
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

describe('review findings', () => {
  const csv = async () => (await app.inject({ method: 'GET', url: '/api/audit/export.csv', headers: as('u-casey') })).body;

  it('rejects inherited object keys as reason codes', async () => {
    const id = caseIdWhere("status = 'new' AND risk_level = 'low'");
    await action('u-alex', id, 'claim');
    for (const reasonCode of ['constructor', 'toString', '__proto__']) {
      expect((await action('u-alex', id, 'approve', { reasonCode })).statusCode).toBe(400);
    }
    expect((db.prepare('SELECT status FROM cases WHERE id = ?').get(id) as { status: string }).status).toBe('in_review');
  });

  it('an analyst loses access once their first approval hands the case on', async () => {
    const id = caseIdWhere("status = 'new' AND risk_level = 'high'");
    await action('u-alex', id, 'claim');
    expect((await action('u-alex', id, 'approve', { reasonCode: 'docs_verified' })).json().status).toBe('pending_second_approval');
    expect((await app.inject({ method: 'GET', url: `/api/kyc/cases/${id}`, headers: as('u-alex') })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/api/kyc/cases/${id}`, headers: as('u-sam') })).statusCode).toBe(200);
  });

  it('exports the full audit log in ID order', async () => {
    const lines = (await csv()).trim().split('\n');
    const total = (db.prepare('SELECT COUNT(*) AS n FROM audit_events').get() as { n: number }).n;
    expect(lines).toHaveLength(total + 1);
    expect(lines[1].startsWith('1,')).toBe(true);
  });

  it('neutralises spreadsheet formulas in the CSV export', async () => {
    const id = caseIdWhere("status = 'new'");
    await action('u-alex', id, 'claim');
    await action('u-alex', id, 'escalate', { note: '=HYPERLINK("http://evil.example","click")' });
    const body = await csv();
    expect(body).toContain(`"'=HYPERLINK(""http://evil.example"",""click"")"`);
    expect(body).not.toMatch(/(^|,)=HYPERLINK/m);
  });

  it('detects events removed from the end of the chain', async () => {
    expect(verifyChain(db).ok).toBe(true);
    db.exec('DROP TRIGGER audit_events_no_delete');
    db.prepare('DELETE FROM audit_events WHERE id = (SELECT MAX(id) FROM audit_events)').run();
    const res = verifyChain(db);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/missing/);
    expect(() => db.prepare('UPDATE audit_chain_head SET last_id = last_id - 1').run()).toThrow(/forward/);
  });
});

describe('dashboard drill-down filters', () => {
  const list = async (filter: string, userId = 'u-sam') =>
    (await app.inject({ method: 'GET', url: `/api/kyc/cases?filter=${filter}`, headers: as(userId) })).json() as {
      status: string;
      riskLevel: string;
      createdAt: string;
      secondApproverId: string | null;
    }[];
  const closed = (s: string) => s === 'approved' || s === 'rejected';

  it('each KPI filter returns only matching cases and agrees with the stats', async () => {
    const stats = (await app.inject({ method: 'GET', url: '/api/kyc/stats', headers: as('u-sam') })).json();
    const open = await list('open');
    expect(open).toHaveLength(stats.open);
    expect(open.every((c) => !closed(c.status))).toBe(true);

    const overdue = await list('overdue');
    expect(overdue).toHaveLength(stats.slaBreaches);
    expect(overdue.every((c) => !closed(c.status) && Date.now() - Date.parse(c.createdAt) >= 48 * 3_600_000)).toBe(true);

    expect(await list('four_eyes')).toHaveLength(stats.fourEyesApprovals);
    expect((await list('four_eyes')).every((c) => c.secondApproverId)).toBe(true);
    expect((await list('decided_7d')).every((c) => closed(c.status))).toBe(true);
    expect((await list('in_review')).every((c) => c.status === 'in_review')).toBe(true);
    expect(await list('approved')).toHaveLength(stats.byStatus.approved);
    expect((await list('approved')).every((c) => c.status === 'approved')).toBe(true);
    expect(await list('rejected')).toHaveLength(stats.byStatus.rejected);
    for (const r of ['low', 'medium', 'high']) {
      const cases = await list(`risk_${r}`);
      expect(cases).toHaveLength(stats.byRisk[r]);
      expect(cases.every((c) => c.riskLevel === r)).toBe(true);
    }
  });

  it('drill-down lists still apply row-level access', async () => {
    const stats = (await app.inject({ method: 'GET', url: '/api/kyc/stats', headers: as('u-alex') })).json();
    expect(await list('open', 'u-alex')).toHaveLength(stats.open);
  });
});

describe('drill-down authorization', () => {
  const FILTERS = ['all', 'new', 'mine', 'in_review', 'approved', 'rejected', 'pending_info', 'escalated', 'second_approval', 'closed', 'open', 'overdue', 'decided_7d', 'four_eyes', 'risk_low', 'risk_medium', 'risk_high'];
  const auditCount = () => (db.prepare('SELECT COUNT(*) AS n FROM audit_events').get() as { n: number }).n;

  it('every filtered list, for every role, contains only cases that role may open', async () => {
    for (const user of USERS as User[]) {
      for (const filter of FILTERS) {
        const res = await app.inject({ method: 'GET', url: `/api/kyc/cases?filter=${filter}`, headers: as(user.id) });
        expect(res.statusCode).toBe(200);
        for (const c of res.json() as KycCase[]) {
          expect(can(user, 'case.view', c).ok, `${user.id} saw ${c.id} via ${filter}`).toBe(true);
        }
      }
    }
  });

  it('analysts never see another analyst\'s cases through any filter', async () => {
    for (const filter of FILTERS) {
      const cases = (await app.inject({ method: 'GET', url: `/api/kyc/cases?filter=${filter}`, headers: as('u-alex') })).json() as KycCase[];
      for (const c of cases) expect(c.assigneeId === 'u-alex' || (c.status === 'new' && c.assigneeId === null)).toBe(true);
    }
  });

  it('lists return no SSN, date of birth, country or full name, and each load writes one access event', async () => {
    const n = auditCount();
    const res = await app.inject({ method: 'GET', url: '/api/kyc/cases?filter=open', headers: as('u-sam') });
    const cases = res.json() as Record<string, unknown>[];
    expect(res.body).not.toMatch(/"ssn|dateOfBirth|country|vendorChecks|\d{3}-\d{2}-\d{4}/);
    for (const c of cases) expect(String(c.customerName)).toMatch(/^\S+( \S\.)?$/);
    expect(auditCount()).toBe(n + 1);
    const ev = db.prepare('SELECT * FROM audit_events ORDER BY id DESC LIMIT 1').get() as Record<string, string>;
    expect(ev).toMatchObject({ app_id: 'kyc', action: 'case.list_viewed', actor_id: 'u-sam', entity_id: 'open' });
    expect(JSON.parse(ev.changes).returned.to).toHaveLength(cases.length);
    const id = caseIdWhere("status = 'new'");
    const full = (await app.inject({ method: 'GET', url: `/api/kyc/cases/${id}`, headers: as('u-sam') })).json();
    expect(full.dateOfBirth).toBeTruthy();
    expect(auditFor(id).at(-1)).toMatchObject({ action: 'case.viewed', actor_id: 'u-sam' });
  });

  it('a denied case open returns 403 and writes nothing', async () => {
    const beas = caseIdWhere("assignee_id = 'u-bea'");
    const n = auditCount();
    expect((await app.inject({ method: 'GET', url: `/api/kyc/cases/${beas}`, headers: as('u-alex') })).statusCode).toBe(403);
    expect(auditCount()).toBe(n);
  });

  it('the SSN-reveal drill-down target (audit log) is compliance-admin only, on every audit endpoint', async () => {
    for (const userId of ['u-alex', 'u-bea', 'u-sam', 'u-riley']) {
      for (const url of ['/api/audit', '/api/audit/verify', '/api/audit/export.csv']) {
        expect((await app.inject({ method: 'GET', url, headers: as(userId) })).statusCode, `${userId} ${url}`).toBe(403);
      }
    }
    expect((await app.inject({ method: 'GET', url: '/api/audit', headers: as('u-casey') })).statusCode).toBe(200);
  });
});

describe('audit drill-down', () => {
  it('returns every matching event in the window, matching the dashboard count', async () => {
    const id = caseIdWhere("status = 'new'");
    await action('u-sam', id, 'claim');
    await app.inject({ method: 'POST', url: `/api/cases/${id}/reveal-ssn`, headers: as('u-sam'), payload: { justification: 'Check' } });
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const events = (await app.inject({ method: 'GET', url: `/api/audit?action=case.ssn_revealed&since=${encodeURIComponent(since)}`, headers: as('u-casey') })).json() as { action: string; at: string }[];
    const stats = (await app.inject({ method: 'GET', url: '/api/stats', headers: as('u-casey') })).json();
    expect(events).toHaveLength(stats.ssnReveals7d);
    expect(events.every((e) => e.action === 'case.ssn_revealed' && e.at >= since)).toBe(true);
  });
});
