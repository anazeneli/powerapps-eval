import { allow, deny, type AppUser, type Decision } from './platform';

export type FlagRole = 'viewer' | 'editor' | 'release_manager';
export const ENVIRONMENTS = ['dev', 'staging', 'prod'] as const;
export type Env = (typeof ENVIRONMENTS)[number];

export interface FlagChange {
  id: number;
  flagKey: string;
  env: Env;
  enabled: boolean;
  reason: string;
  requestedBy: string;
  status: 'pending' | 'approved' | 'rejected';
  decidedBy: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface Flag {
  key: string;
  description: string;
  owner: string;
  critical: boolean;
  enabled: Record<Env, boolean>;
  updatedAt: string;
  pendingChange: FlagChange | null;
}

export type FlagAction = 'flag.change' | 'flag.decide_change';

/** Production changes to money-movement flags need a release manager's approval. */
export const needsApproval = (flag: Pick<Flag, 'critical'>, env: Env) => env === 'prod' && flag.critical;

export function canFlag(user: AppUser<FlagRole>, action: FlagAction, change?: Pick<FlagChange, 'requestedBy' | 'status'>): Decision {
  if (action === 'flag.change') return user.role === 'viewer' ? deny('Viewers cannot change flags') : allow;
  if (user.role !== 'release_manager') return deny('Only release managers approve production changes to critical flags');
  if (!change || change.status !== 'pending') return deny('No pending change');
  if (change.requestedBy === user.id) return deny('You cannot approve your own change');
  return allow;
}
