import type { AppId } from '@kyc/shared';
import type { DB } from './platform/db.js';
import { appendAudit } from './platform/audit.js';
import { seedKyc } from './apps/kyc/seed.js';
import { seedRefunds } from './apps/refunds/seed.js';
import { seedFlags } from './apps/flags/seed.js';

export const PEOPLE: { id: string; name: string; title: string; roles: Partial<Record<AppId, string>> }[] = [
  { id: 'u-taylor', name: 'Taylor Brooks', title: 'VP Engineering', roles: { kyc: 'compliance_admin', refunds: 'viewer', flags: 'viewer', audit: 'auditor' } },
  { id: 'u-alex', name: 'Alex Rivera', title: 'KYC Analyst', roles: { kyc: 'analyst', refunds: 'agent' } },
  { id: 'u-bea', name: 'Bea Okafor', title: 'KYC Analyst', roles: { kyc: 'analyst' } },
  { id: 'u-sam', name: 'Sam Chen', title: 'Senior KYC Reviewer', roles: { kyc: 'senior_reviewer', refunds: 'approver' } },
  { id: 'u-riley', name: 'Riley Park', title: 'Senior KYC Reviewer', roles: { kyc: 'senior_reviewer' } },
  { id: 'u-casey', name: 'Casey Morgan', title: 'Compliance Officer', roles: { kyc: 'compliance_admin', audit: 'auditor' } },
  { id: 'u-jordan', name: 'Jordan Lee', title: 'Support Agent', roles: { refunds: 'agent' } },
  { id: 'u-morgan', name: 'Morgan Diaz', title: 'Finance Manager', roles: { refunds: 'finance_manager' } },
  { id: 'u-dev', name: 'Dev Patel', title: 'Software Engineer', roles: { flags: 'editor' } },
  { id: 'u-priya', name: 'Priya Shah', title: 'Engineering Manager', roles: { flags: 'release_manager' } },
  { id: 'u-avery', name: 'Avery Kim', title: 'IT Administrator', roles: { access: 'admin', audit: 'auditor' } },
  { id: 'u-quinn', name: 'Quinn Fox', title: 'IT Administrator', roles: { access: 'admin' } },
];

const PROVISIONING = { id: 'system:provisioning', role: 'system' };

export function seed(db: DB, opts: { count?: number; now?: number } = {}): void {
  const now = opts.now ?? Date.now();
  db.transaction(() => {
    const at = new Date(now - 30 * 86_400_000).toISOString();
    for (const p of PEOPLE) {
      db.prepare('INSERT INTO users (id, name, title, created_at) VALUES (?, ?, ?, ?)').run(p.id, p.name, p.title, at);
      for (const [appId, role] of Object.entries(p.roles)) {
        db.prepare('INSERT INTO app_roles (user_id, app_id, role, granted_by, granted_at) VALUES (?, ?, ?, ?, ?)').run(p.id, appId, role, PROVISIONING.id, at);
        appendAudit(db, {
          appId: 'access',
          actor: PROVISIONING,
          action: 'access.granted',
          entityType: 'user',
          entityId: p.id,
          changes: { [appId]: { from: null, to: role } },
          reason: 'Initial provisioning',
        });
      }
    }
  })();
  seedKyc(db, opts);
  seedRefunds(db, now);
  seedFlags(db, now);
}
