import type { AppUser, FlagRole } from '@kyc/shared';
import type { DB } from '../../platform/db.js';
import { asAppUser } from '../../platform/auth.js';
import { changeFlag, decideChange } from './flags.js';

// key, description, owner, critical (money movement), dev, staging, prod
const FLAGS: [string, string, string, boolean, boolean, boolean, boolean][] = [
  ['instant_payouts', 'Instant payouts to debit cards', 'Payments', true, true, true, false],
  ['ach_same_day', 'Same-day ACH transfers', 'Payments', true, true, true, true],
  ['card_spend_limits_v2', 'New card spend-limit engine', 'Cards', true, true, false, false],
  ['referral_bonus_2026', 'Pay $50 referral bonus on first deposit', 'Growth', true, true, true, false],
  ['kyc_vendor_fallback', 'Route IDV to the backup vendor on timeout', 'Risk', true, true, true, true],
  ['onboarding_flow_v3', 'Redesigned sign-up flow', 'Growth', false, true, true, true],
  ['statements_pdf_v2', 'New PDF statement layout', 'Accounts', false, true, false, false],
  ['support_chat_widget', 'In-app support chat', 'Support', false, true, true, true],
  ['dark_mode', 'Dark mode in the mobile app', 'Mobile', false, true, true, false],
  ['spending_insights', 'Monthly spending insights card', 'Accounts', false, true, false, false],
];

export function seedFlags(db: DB, now = Date.now()): void {
  db.transaction(() => {
    const insert = db.prepare('INSERT INTO flags (key, description, owner, critical, dev, staging, prod, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const [key, desc, owner, critical, dev, staging, prod] of FLAGS) {
      insert.run(key, desc, owner, critical ? 1 : 0, dev ? 1 : 0, staging ? 1 : 0, prod ? 1 : 0, new Date(now - 5 * 86_400_000).toISOString());
    }
    const u = (id: string) => asAppUser(db, id, 'flags') as AppUser<FlagRole>;
    const dev = u('u-dev');
    const priya = u('u-priya');

    changeFlag(db, dev, 'statements_pdf_v2', { env: 'staging', enabled: true, reason: 'Ready for QA' });
    changeFlag(db, dev, 'dark_mode', { env: 'prod', enabled: true, reason: 'Beta feedback positive; non-financial' });
    changeFlag(db, dev, 'referral_bonus_2026', { env: 'prod', enabled: true, reason: 'Q4 growth campaign launch' });
    const approved = db.prepare("SELECT id FROM flag_changes WHERE flag_key = 'referral_bonus_2026'").get() as { id: number };
    decideChange(db, priya, approved.id, 'approve', 'Finance signed off on bonus budget');
    changeFlag(db, dev, 'instant_payouts', { env: 'prod', enabled: true, reason: 'Launch for 10% cohort per PRD-212' });
  })();
}
