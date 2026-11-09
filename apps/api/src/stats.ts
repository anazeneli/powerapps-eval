import { CASE_STATUSES, SLA_HOURS, type KycStats, type User } from '@kyc/shared';
import type { DB } from './db.js';
import { listCases } from './kyc.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Read-only: computes dashboard numbers without writing audit events or returning customer fields. */
export function kycStats(db: DB, user: User, now = Date.now()): KycStats {
  const cases = listCases(db, user, 'all');
  const created = new Map(cases.map((c) => [c.id, Date.parse(c.createdAt)]));

  const byStatus = Object.fromEntries(CASE_STATUSES.map((s) => [s, 0])) as KycStats['byStatus'];
  const byRisk: KycStats['byRisk'] = { low: 0, medium: 0, high: 0 };
  let open = 0;
  let slaBreaches = 0;
  let fourEyesApprovals = 0;
  for (const c of cases) {
    byStatus[c.status]++;
    byRisk[c.riskLevel]++;
    if (c.secondApproverId) fourEyesApprovals++;
    if (c.status !== 'approved' && c.status !== 'rejected') {
      open++;
      if (now - Date.parse(c.createdAt) >= SLA_HOURS * HOUR) slaBreaches++;
    }
  }

  const days = Array.from({ length: 7 }, (_, i) => new Date(now - (6 - i) * DAY).toISOString().slice(0, 10));
  const decisionsByDay = days.map((date) => ({ date, approved: 0, rejected: 0 }));
  const events = db
    .prepare(
      `SELECT entity_id, action, at, changes FROM audit_events
       WHERE entity_type = 'case' AND at >= ? AND action IN ('case.approve', 'case.reject', 'case.ssn_revealed')`,
    )
    .all(new Date(now - 7 * DAY).toISOString()) as { entity_id: string; action: string; at: string; changes: string | null }[];

  let ssnReveals7d = 0;
  let approved = 0;
  let rejected = 0;
  let hours = 0;
  for (const e of events) {
    if (!created.has(e.entity_id)) continue;
    if (e.action === 'case.ssn_revealed') {
      ssnReveals7d++;
      continue;
    }
    const to: string | undefined = e.changes ? JSON.parse(e.changes).status?.to : undefined;
    if (to !== 'approved' && to !== 'rejected') continue;
    if (to === 'approved') approved++;
    else rejected++;
    hours += (Date.parse(e.at) - created.get(e.entity_id)!) / HOUR;
    const bucket = decisionsByDay.find((d) => d.date === e.at.slice(0, 10));
    if (bucket) bucket[to]++;
  }
  const decided7d = approved + rejected;

  return {
    scope: user.role === 'analyst' ? 'visible' : 'all',
    open,
    slaBreaches,
    decided7d,
    avgHoursToDecision: decided7d ? Math.round((hours / decided7d) * 10) / 10 : null,
    approvalRate: decided7d ? Math.round((approved / decided7d) * 100) : null,
    fourEyesApprovals,
    awaitingSecond: byStatus.pending_second_approval,
    ssnReveals7d,
    byStatus,
    byRisk,
    decisionsByDay,
  };
}
