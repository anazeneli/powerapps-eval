import { allow, deny, type AppUser, type Decision } from './platform';

export type RefundRole = 'agent' | 'approver' | 'finance_manager' | 'viewer';

export const REFUND_STATUSES = ['pending_approval', 'pending_second_approval', 'issued', 'rejected'] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

/** Refunds above this (in cents) need a second approval from a finance manager. */
export const SINGLE_APPROVAL_LIMIT = 100_000;

export const REFUND_REASON_CODES = {
  duplicate_charge: 'Duplicate charge',
  service_not_delivered: 'Service not delivered',
  fraud_dispute: 'Customer reports unauthorized charge',
  goodwill: 'Goodwill credit',
} as const;

export const REFUND_REJECT_CODES = {
  outside_policy: 'Outside refund policy',
  insufficient_evidence: 'Insufficient evidence',
  already_resolved: 'Already resolved another way',
} as const;

export interface Charge {
  id: string;
  customerName: string;
  description: string;
  amount: number;
  currency: string;
  createdAt: string;
  refundable: number;
}

export interface Refund {
  id: string;
  chargeId: string;
  customerName: string;
  chargeAmount: number;
  amount: number;
  currency: string;
  reasonCode: string;
  note: string | null;
  status: RefundStatus;
  requesterId: string;
  firstApproverId: string | null;
  secondApproverId: string | null;
  rejectReasonCode: string | null;
  processorRefundId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type RefundAction = 'refund.view' | 'refund.create' | 'refund.approve' | 'refund.reject';
type RefundRef = Pick<Refund, 'status' | 'requesterId' | 'firstApproverId' | 'amount'>;

export const needsSecondApproval = (amount: number) => amount > SINGLE_APPROVAL_LIMIT;

/** Single authorization check for refunds, shared by the API and the UI. */
export function canRefund(user: AppUser<RefundRole>, action: RefundAction, r?: RefundRef): Decision {
  const decider = user.role === 'approver' || user.role === 'finance_manager';
  if (action === 'refund.create') {
    return user.role === 'viewer' ? deny('Viewers cannot request refunds') : allow;
  }
  if (!r) return deny('Refund required');
  switch (action) {
    case 'refund.view':
      if (user.role === 'agent' && r.requesterId !== user.id) return deny('Support agents only see their own requests');
      return allow;
    case 'refund.approve':
    case 'refund.reject':
      if (!decider) return deny('Only approvers and finance managers can decide refunds');
      if (r.requesterId === user.id) return deny('You cannot decide a refund you requested');
      if (r.status === 'pending_approval') return allow;
      if (r.status === 'pending_second_approval') {
        if (r.firstApproverId === user.id) return deny('The first approver cannot give the second approval');
        if (action === 'refund.approve' && user.role !== 'finance_manager')
          return deny('Refunds over $1,000 need a finance manager for the second approval');
        return allow;
      }
      return deny('This refund is already closed');
  }
}

export function formatMoney(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}
