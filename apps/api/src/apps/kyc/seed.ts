import type { CheckOutcome, KycCase, User, VendorCheck } from '@kyc/shared';
import type { DB } from '../../platform/db.js';
import { appendAudit } from '../../platform/audit.js';
import { asAppUser } from '../../platform/auth.js';
import { performAction } from './kyc.js';

const FIRST = ['Maya', 'Liam', 'Sofia', 'Noah', 'Aisha', 'Mateo', 'Chloe', 'Ethan', 'Priya', 'Lucas', 'Zara', 'Diego', 'Hana', 'Owen', 'Fatima', 'Leo', 'Grace', 'Kenji', 'Amara', 'Jonah'];
const LAST = ['Patel', 'Nguyen', 'Garcia', 'Kim', 'Okonkwo', 'Silva', 'Johnson', 'Haddad', 'Novak', 'Brown', 'Tanaka', 'Mensah', 'Rossi', 'Cohen', 'Lopez'];
const COUNTRIES = ['US', 'US', 'US', 'US', 'US', 'GB', 'CA', 'MX', 'NG', 'DE'];

const CHECKS: Record<string, Record<CheckOutcome, string>> = {
  'Document authenticity': {
    pass: 'Driver license security features verified',
    review: 'Glare on document; MRZ partially unreadable',
    fail: 'Font inconsistencies detected in date of birth field',
  },
  'Selfie / liveness': {
    pass: 'Face match 97%, liveness passed',
    review: 'Face match 71%, below auto-approve threshold',
    fail: 'Liveness check failed (possible screen replay)',
  },
  'Watchlist screening (OFAC/PEP)': {
    pass: 'No matches',
    review: 'Possible name match on PEP list (score 0.82)',
    fail: 'Strong match on OFAC SDN list (score 0.96)',
  },
  'Address verification': {
    pass: 'Address matches credit header',
    review: 'Address not found in credit header',
    fail: 'Address is a known mail drop',
  },
};

/** Deterministic PRNG so the seed data is the same on every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const SYSTEM = { id: 'system:idv-vendor', role: 'system' };

export function seedKyc(db: DB, opts: { count?: number; now?: number } = {}): void {
  const count = opts.count ?? 50;
  const now = opts.now ?? Date.now();
  const rand = rng(42);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];

  db.transaction(() => {

    const insertCase = db.prepare(
      `INSERT INTO cases (id, customer_name, date_of_birth, country, ssn, risk_level, risk_score, vendor_checks, status, created_at, updated_at)
       VALUES (@id, @customer_name, @date_of_birth, @country, @ssn, @risk_level, @risk_score, @vendor_checks, 'new', @created_at, @created_at)`,
    );

    const cases: { id: string; created: number }[] = [];
    for (let i = 0; i < count; i++) {
      const checks: VendorCheck[] = Object.entries(CHECKS).map(([check, details]) => {
        const r = rand();
        const outcome: CheckOutcome = r < 0.6 ? 'pass' : r < 0.9 ? 'review' : 'fail';
        return { check, outcome, detail: details[outcome] };
      });
      if (checks.every((c) => c.outcome === 'pass')) {
        const c = checks[Math.floor(rand() * checks.length)];
        c.outcome = 'review';
        c.detail = CHECKS[c.check].review;
      }
      const score = Math.min(
        99,
        checks.reduce((s, c) => s + (c.outcome === 'fail' ? 45 : c.outcome === 'review' ? 20 : 0), 0) + Math.floor(rand() * 10),
      );
      const riskLevel: KycCase['riskLevel'] = score >= 60 ? 'high' : score >= 35 ? 'medium' : 'low';
      const created = now - Math.floor(rand() * 72 * 3600 * 1000);
      const ssn = `${100 + Math.floor(rand() * 800)}-${10 + Math.floor(rand() * 89)}-${1000 + Math.floor(rand() * 8999)}`;
      const year = 1955 + Math.floor(rand() * 50);
      const month = String(1 + Math.floor(rand() * 12)).padStart(2, '0');
      const day = String(1 + Math.floor(rand() * 28)).padStart(2, '0');
      const id = `KYC-${1001 + i}`;
      cases.push({ id, created });
      insertCase.run({
        id,
        customer_name: `${pick(FIRST)} ${pick(LAST)}`,
        date_of_birth: `${year}-${month}-${day}`,
        country: pick(COUNTRIES),
        ssn,
        risk_level: riskLevel,
        risk_score: score,
        vendor_checks: JSON.stringify(checks),
        created_at: new Date(created).toISOString(),
      });
    }

    // Audit the vendor-created cases in creation order.
    for (const c of [...cases].sort((a, b) => a.created - b.created)) {
      appendAudit(db, {
        appId: 'kyc',
        actor: SYSTEM,
        action: 'case.created',
        entityType: 'case',
        entityId: c.id,
        reason: 'Automated identity verification returned exceptions',
      });
    }

    // Move a few cases through the workflow using the real write path so the audit trail is consistent.
    const rows = db.prepare('SELECT id, risk_level FROM cases ORDER BY id').all() as { id: string; risk_level: string }[];
    const used = new Set<string>();
    const take = (pred: (r: { risk_level: string }) => boolean) => {
      const r = rows.find((x) => !used.has(x.id) && pred(x));
      if (!r) throw new Error('seed: no matching case');
      used.add(r.id);
      return r.id;
    };
    const user = (id: string) => asAppUser(db, id, 'kyc') as User;
    const alex = user('u-alex');
    const bea = user('u-bea');
    const sam = user('u-sam');

    for (let i = 0; i < 3; i++) performAction(db, alex, take((r) => r.risk_level !== 'high'), 'claim');
    performAction(db, alex, take((r) => r.risk_level === 'high'), 'claim');

    const info = take(() => true);
    performAction(db, alex, info, 'claim');
    performAction(db, alex, info, 'request_info', { note: 'Asked customer for a clearer photo of the license' });

    const esc = take(() => true);
    performAction(db, bea, esc, 'claim');
    performAction(db, bea, esc, 'escalate', { note: 'Possible PEP match; needs senior review' });

    const second = take((r) => r.risk_level === 'high');
    performAction(db, bea, second, 'claim');
    performAction(db, bea, second, 'approve', { reasonCode: 'watchlist_false_positive', note: 'DOB differs from listed PEP' });

    const approved = take((r) => r.risk_level === 'low');
    performAction(db, bea, approved, 'claim');
    performAction(db, bea, approved, 'approve', { reasonCode: 'docs_verified' });

    const rejected = take(() => true);
    performAction(db, sam, rejected, 'claim');
    performAction(db, sam, rejected, 'reject', { reasonCode: 'document_fraud', note: 'Template match to known fake license' });
  })();
}
