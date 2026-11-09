import { SLA_HOURS, type CaseStatus, type User } from '@kyc/shared';

export const STATUS_LABELS: Record<CaseStatus, string> = {
  new: 'New',
  in_review: 'In review',
  pending_info: 'Waiting on customer',
  escalated: 'Escalated',
  pending_second_approval: 'Awaiting 2nd approval',
  approved: 'Approved',
  rejected: 'Rejected',
};

export const ROLE_LABELS: Record<string, string> = {
  analyst: 'Analyst',
  senior_reviewer: 'Senior reviewer',
  compliance_admin: 'Compliance admin',
  system: 'System',
};

export function age(createdAt: string): { hours: number; label: string; overdue: boolean } {
  const hours = Math.floor((Date.now() - new Date(createdAt).getTime()) / 3_600_000);
  const label = hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d ${hours % 24}h`;
  return { hours, label, overdue: hours >= SLA_HOURS };
}

export function userName(users: User[] | undefined, id: string | null): string {
  if (!id) return '—';
  return users?.find((u) => u.id === id)?.name ?? id;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString();
}
