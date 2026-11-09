export type Role = 'analyst' | 'senior_reviewer' | 'compliance_admin';

export interface User {
  id: string;
  name: string;
  role: Role;
}

export const CASE_STATUSES = [
  'new',
  'in_review',
  'pending_info',
  'escalated',
  'pending_second_approval',
  'approved',
  'rejected',
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export type RiskLevel = 'low' | 'medium' | 'high';

export type CheckOutcome = 'pass' | 'review' | 'fail';

export interface VendorCheck {
  check: string;
  outcome: CheckOutcome;
  detail: string;
}

export interface KycCase {
  id: string;
  customerName: string;
  dateOfBirth: string;
  country: string;
  ssnMasked: string;
  riskLevel: RiskLevel;
  riskScore: number;
  vendorChecks: VendorCheck[];
  status: CaseStatus;
  assigneeId: string | null;
  firstApproverId: string | null;
  secondApproverId: string | null;
  decisionReasonCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEvent {
  id: number;
  at: string;
  actorId: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  reason: string | null;
  requestId: string | null;
  hash: string;
}

export const APPROVE_REASON_CODES = {
  docs_verified: 'Documents verified',
  manual_match_confirmed: 'Manual identity match confirmed',
  watchlist_false_positive: 'Watchlist hit is a false positive',
} as const;

export const REJECT_REASON_CODES = {
  document_fraud: 'Suspected document fraud',
  identity_mismatch: 'Identity mismatch',
  sanctions_match: 'Confirmed sanctions/watchlist match',
  unable_to_verify: 'Unable to verify identity',
} as const;

export type ApproveReasonCode = keyof typeof APPROVE_REASON_CODES;
export type RejectReasonCode = keyof typeof REJECT_REASON_CODES;

export const SLA_HOURS = 48;

export type Action =
  | 'case.view'
  | 'case.claim'
  | 'case.request_info'
  | 'case.resume'
  | 'case.escalate'
  | 'case.approve'
  | 'case.reject'
  | 'case.reveal_ssn'
  | 'audit.view_all';

export type Decision = { ok: true } | { ok: false; reason: string };

const allow: Decision = { ok: true };
const deny = (reason: string): Decision => ({ ok: false, reason });

type CaseRef = Pick<KycCase, 'status' | 'assigneeId' | 'firstApproverId'>;

/**
 * Single authorization check shared by the API (enforcement) and the UI (button state).
 * The API is the source of truth; the UI only uses this to explain why an action is unavailable.
 */
export function can(user: User, action: Action, c?: CaseRef): Decision {
  const isAssignee = !!c && c.assigneeId === user.id;
  const reviewer = user.role === 'analyst' || user.role === 'senior_reviewer';

  if (action === 'audit.view_all') {
    return user.role === 'compliance_admin' ? allow : deny('Only compliance admins can view the full audit log');
  }
  if (!c) return deny('Case required');

  switch (action) {
    case 'case.view':
      if (user.role !== 'analyst') return allow;
      if (isAssignee) return allow;
      if (c.status === 'new' && c.assigneeId === null) return allow;
      return deny('Analysts can only open unassigned new cases or cases assigned to them');

    case 'case.claim':
      if (!reviewer) return deny('Only reviewers can claim cases');
      if (c.assigneeId !== null) return deny('Case is already assigned');
      if (c.status === 'new') return allow;
      if (c.status === 'escalated')
        return user.role === 'senior_reviewer' ? allow : deny('Escalated cases need a senior reviewer');
      return deny(`Cannot claim a case in status "${c.status}"`);

    case 'case.request_info':
    case 'case.escalate':
      if (!isAssignee) return deny('Only the assignee can do this');
      if (c.status !== 'in_review') return deny('Case must be in review');
      if (action === 'case.escalate' && user.role !== 'analyst') return deny('Only analysts escalate');
      return allow;

    case 'case.resume':
      if (!isAssignee) return deny('Only the assignee can do this');
      return c.status === 'pending_info' ? allow : deny('Case is not waiting on information');

    case 'case.approve':
    case 'case.reject':
      if (c.status === 'in_review') return isAssignee ? allow : deny('Only the assignee can decide');
      if (c.status === 'pending_second_approval') {
        if (user.role !== 'senior_reviewer') return deny('Second approval requires a senior reviewer');
        if (c.firstApproverId === user.id) return deny('The first approver cannot give the second approval');
        return allow;
      }
      return deny(`Cannot decide a case in status "${c.status}"`);

    case 'case.reveal_ssn':
      if (user.role !== 'analyst') return allow;
      return isAssignee ? allow : deny('Analysts can only reveal SSNs on cases assigned to them');
  }
}

export function maskSsn(ssn: string): string {
  return `***-**-${ssn.slice(-4)}`;
}

/** Aggregates for the dashboard. Counts only, no customer data; scoped to the cases the caller can view. */
export interface KycStats {
  scope: 'all' | 'visible';
  open: number;
  slaBreaches: number;
  decided7d: number;
  avgHoursToDecision: number | null;
  approvalRate: number | null;
  fourEyesApprovals: number;
  awaitingSecond: number;
  ssnReveals7d: number;
  byStatus: Record<CaseStatus, number>;
  byRisk: Record<RiskLevel, number>;
  decisionsByDay: { date: string; approved: number; rejected: number }[];
}
