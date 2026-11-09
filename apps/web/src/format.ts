import {
  APPROVE_REASON_CODES,
  CASE_STATUSES,
  REJECT_REASON_CODES,
  SLA_HOURS,
  type AuditEvent,
  type CaseStatus,
  type RiskLevel,
} from '@kyc/shared';

export type CaseFilter =
  | 'all'
  | 'new'
  | 'mine'
  | 'in_review'
  | 'pending_info'
  | 'escalated'
  | 'second_approval'
  | 'closed'
  | 'open'
  | 'overdue'
  | 'decided_7d'
  | 'four_eyes'
  | 'risk_low'
  | 'risk_medium'
  | 'risk_high';
export type BadgeColor = 'brand' | 'danger' | 'important' | 'informative' | 'severe' | 'subtle' | 'success' | 'warning';

export const VIEW_LABELS: Record<CaseFilter, string> = {
  mine: 'My cases',
  all: 'All cases',
  new: 'New',
  pending_info: 'Waiting on customer',
  escalated: 'Escalated',
  second_approval: 'Awaiting 2nd approval',
  closed: 'Closed',
  in_review: 'In review',
  open: 'Open cases',
  overdue: 'SLA breached (>48h)',
  decided_7d: 'Decided in the last 7 days',
  four_eyes: 'Four-eyes approvals',
  risk_low: 'Low-risk cases',
  risk_medium: 'Medium-risk cases',
  risk_high: 'High-risk cases',
};

export const STATUS_FILTERS: Record<CaseStatus, CaseFilter> = {
  new: 'new',
  in_review: 'in_review',
  pending_info: 'pending_info',
  escalated: 'escalated',
  pending_second_approval: 'second_approval',
  approved: 'closed',
  rejected: 'closed',
};

export const STATUS_LABELS: Record<CaseStatus, string> = {
  new: 'New',
  in_review: 'In review',
  pending_info: 'Waiting on customer',
  escalated: 'Escalated',
  pending_second_approval: 'Awaiting 2nd approval',
  approved: 'Approved',
  rejected: 'Rejected',
};

export const STATUS_COLORS: Record<CaseStatus, BadgeColor> = {
  new: 'informative',
  in_review: 'brand',
  pending_info: 'warning',
  escalated: 'severe',
  pending_second_approval: 'important',
  approved: 'success',
  rejected: 'danger',
};

export const RISK_COLORS: Record<RiskLevel, BadgeColor> = { low: 'success', medium: 'warning', high: 'danger' };

export const statusOrder = (s: CaseStatus) => CASE_STATUSES.indexOf(s);
export const isClosed = (s: CaseStatus) => s === 'approved' || s === 'rejected';

export const ROLE_LABELS: Record<string, string> = {
  analyst: 'Analyst',
  senior_reviewer: 'Senior reviewer',
  compliance_admin: 'Compliance admin',
  agent: 'Support agent',
  approver: 'Approver',
  finance_manager: 'Finance manager',
  viewer: 'Viewer',
  editor: 'Editor',
  release_manager: 'Release manager',
  auditor: 'Auditor',
  admin: 'Access admin',
  system: 'System',
};

export const REASON_LABELS: Record<string, string> = { ...APPROVE_REASON_CODES, ...REJECT_REASON_CODES };

const FIELD_LABELS: Record<string, string> = {
  status: 'Status',
  assigneeId: 'Owner',
  firstApproverId: 'First approver',
  secondApproverId: 'Second approver',
  decisionReasonCode: 'Decision reason',
};

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

export type Named = { id: string; name: string };

export function formatValue(field: string, v: unknown, users: Named[]): string {
  if (v === null || v === undefined) return '—';
  if (field === 'status') return STATUS_LABELS[v as CaseStatus] ?? String(v);
  if (field === 'decisionReasonCode') return REASON_LABELS[String(v)] ?? String(v);
  if (field.endsWith('Id')) return userName(users, String(v));
  return String(v);
}

export function auditActionLabel(e: AuditEvent): string {
  switch (e.action) {
    case 'case.created':
      return 'Case created';
    case 'case.viewed':
      return 'Viewed case';
    case 'case.claim':
      return 'Claimed case';
    case 'case.request_info':
      return 'Requested info from customer';
    case 'case.resume':
      return 'Marked info received';
    case 'case.escalate':
      return 'Escalated to senior review';
    case 'case.approve':
      if (e.changes?.status?.to === 'pending_second_approval') return 'Approved (1st of 2)';
      if (e.changes?.secondApproverId) return 'Approved (2nd of 2)';
      return 'Approved';
    case 'case.reject':
      return 'Rejected';
    case 'case.ssn_revealed':
      return 'Revealed full SSN';
    case 'refund.requested':
      return 'Requested refund';
    case 'refund.approve':
      if (e.changes?.status?.to === 'pending_second_approval') return 'Approved refund (1st of 2)';
      return 'Approved refund · issued';
    case 'refund.reject':
      return 'Rejected refund';
    case 'flag.changed':
      return 'Changed flag';
    case 'flag.change_requested':
      return 'Requested production change';
    case 'flag.change_approved':
      return 'Approved production change';
    case 'flag.change_rejected':
      return 'Rejected production change';
    case 'access.granted':
      return 'Granted access';
    case 'access.changed':
      return 'Changed role';
    case 'access.revoked':
      return 'Revoked access';
    case 'access.person_added':
      return 'Added person';
    default:
      return e.action;
  }
}

export function age(createdAt: string): { hours: number; label: string; overdue: boolean } {
  const hours = Math.floor((Date.now() - new Date(createdAt).getTime()) / 3_600_000);
  const label = hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d ${hours % 24}h`;
  return { hours, label, overdue: hours >= SLA_HOURS };
}

export function userName(users: Named[] | undefined, id: string | null): string {
  if (!id) return '—';
  if (id === 'system:provisioning') return 'Provisioning (automated)';
  if (id.startsWith('system:')) return 'Identity vendor (automated)';
  return users?.find((u) => u.id === id)?.name ?? id;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
