export type Decision = { ok: true } | { ok: false; reason: string };
export const allow: Decision = { ok: true };
export const deny = (reason: string): Decision => ({ ok: false, reason });

export const APP_IDS = ['kyc', 'refunds', 'flags', 'audit', 'access'] as const;
export type AppId = (typeof APP_IDS)[number];

export interface AppRoleDef {
  id: string;
  label: string;
  description: string;
}

export interface AppManifest {
  id: AppId;
  name: string;
  description: string;
  category: 'Operations' | 'Engineering' | 'Platform';
  roles: AppRoleDef[];
}

/** The app catalog. Each app declares its roles; access is granted per person, per app. */
export const APPS: AppManifest[] = [
  {
    id: 'kyc',
    name: 'KYC Review',
    description: 'Review identity-verification exceptions, with four-eyes approval for high-risk customers.',
    category: 'Operations',
    roles: [
      { id: 'analyst', label: 'Analyst', description: 'Claims and works new cases; first approval on high-risk cases' },
      { id: 'senior_reviewer', label: 'Senior reviewer', description: 'Escalated cases and second approvals' },
      { id: 'compliance_admin', label: 'Compliance admin', description: 'Read-only on cases' },
    ],
  },
  {
    id: 'refunds',
    name: 'Refunds',
    description: 'Request and approve customer refunds with amount limits and maker-checker controls.',
    category: 'Operations',
    roles: [
      { id: 'agent', label: 'Support agent', description: 'Requests refunds; sees their own requests' },
      { id: 'approver', label: 'Approver', description: 'Approves refunds up to $1,000 and gives first approval above that' },
      { id: 'finance_manager', label: 'Finance manager', description: 'Gives the second approval on refunds over $1,000' },
      { id: 'viewer', label: 'Viewer', description: 'Read-only' },
    ],
  },
  {
    id: 'flags',
    name: 'Feature Flags',
    description: 'Toggle features per environment. Production changes to money-movement flags need approval.',
    category: 'Engineering',
    roles: [
      { id: 'viewer', label: 'Viewer', description: 'Read-only' },
      { id: 'editor', label: 'Editor', description: 'Changes flags; critical production changes go to approval' },
      { id: 'release_manager', label: 'Release manager', description: 'Changes flags and approves critical production changes' },
    ],
  },
  {
    id: 'audit',
    name: 'Audit Center',
    description: 'One append-only, hash-chained audit log across every app, with verification and export.',
    category: 'Platform',
    roles: [{ id: 'auditor', label: 'Auditor', description: 'Reads and exports the audit log for all apps' }],
  },
  {
    id: 'access',
    name: 'Access Admin',
    description: 'Add people and grant or revoke app roles. Every change is audited; admins cannot change their own access.',
    category: 'Platform',
    roles: [{ id: 'admin', label: 'Access admin', description: 'Manages people and app roles' }],
  },
];

export function appManifest(id: string): AppManifest | undefined {
  return APPS.find((a) => a.id === id);
}

export function roleLabel(appId: string, role: string | null | undefined): string {
  if (!role) return '—';
  return appManifest(appId)?.roles.find((r) => r.id === role)?.label ?? role;
}

/** A person acting inside one app, with their role in that app. */
export interface AppUser<R extends string = string> {
  id: string;
  name: string;
  role: R;
}

/** A signed-in person with their roles across apps. */
export interface PlatformUser {
  id: string;
  name: string;
  title: string;
  roles: Partial<Record<AppId, string>>;
}

export interface CatalogEntry extends AppManifest {
  myRole: string | null;
}

export interface AppSummary {
  metrics: { label: string; value: string | number; tone?: 'neutral' | 'warning' | 'danger' | 'success' }[];
}

/** Lists show just enough to triage: first name and last initial. Full details only on the (logged) record page. */
export function shortName(full: string): string {
  const [first, ...rest] = full.trim().split(/\s+/);
  const last = rest.at(-1);
  return last ? `${first} ${last[0]}.` : first;
}

export interface AuditEvent {
  id: number;
  at: string;
  appId: string;
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

export interface AccessGrant {
  appId: AppId;
  role: string;
  grantedBy: string;
  grantedAt: string;
}

export interface Person {
  id: string;
  name: string;
  title: string;
  grants: AccessGrant[];
}
