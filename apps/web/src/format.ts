import {
  APPROVE_REASON_CODES,
  CASE_STATUSES,
  REJECT_REASON_CODES,
  SLA_HOURS,
  type AuditEvent,
  type CaseStatus,
  type RiskLevel,
  type User,
} from '@kyc/shared';

export type CaseFilter = 'all' | 'new' | 'mine' | 'pending_info' | 'escalated' | 'second_approval' | 'closed';
export type BadgeColor = 'brand' | 'danger' | 'important' | 'informative' | 'severe' | 'subtle' | 'success' | 'warning';

export const VIEW_LABELS: Record<CaseFilter, string> = {
  mine: 'My cases',
  all: 'All cases',
  new: 'New',
  pending_info: 'Waiting on customer',
  escalated: 'Escalated',
  second_approval: 'Awaiting 2nd approval',
  closed: 'Closed',
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

export function formatValue(field: string, v: unknown, users: User[]): string {
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
    default:
      return e.action;
  }
}

export function age(createdAt: string): { hours: number; label: string; overdue: boolean } {
  const hours = Math.floor((Date.now() - new Date(createdAt).getTime()) / 3_600_000);
  const label = hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d ${hours % 24}h`;
  return { hours, label, overdue: hours >= SLA_HOURS };
}

export function userName(users: User[] | undefined, id: string | null): string {
  if (!id) return '—';
  if (id.startsWith('system:')) return 'Identity vendor (automated)';
  return users?.find((u) => u.id === id)?.name ?? id;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
