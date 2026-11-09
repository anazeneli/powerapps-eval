import type { AppUser, RefundRole } from '@kyc/shared';
import type { DB } from '../../platform/db.js';
import { asAppUser } from '../../platform/auth.js';
import { createRefund, decideRefund } from './refunds.js';

const CHARGES: [string, string, number][] = [
  ['Maya Patel', 'Premium plan, annual', 119_900],
  ['Liam Nguyen', 'Card replacement fee', 2_500],
  ['Sofia Garcia', 'International wire fee', 4_500],
  ['Noah Kim', 'Premium plan, annual', 119_900],
  ['Aisha Okonkwo', 'Merchant payout correction', 285_000],
  ['Mateo Silva', 'Overdraft fee', 3_500],
  ['Chloe Johnson', 'Business plan, annual', 480_000],
  ['Ethan Haddad', 'Expedited card delivery', 2_900],
  ['Priya Novak', 'Premium plan, monthly', 1_299],
  ['Lucas Brown', 'Loan origination fee', 185_000],
  ['Zara Tanaka', 'ATM fee', 350],
  ['Diego Mensah', 'Business plan, monthly', 39_900],
  ['Hana Rossi', 'International wire fee', 4_500],
  ['Owen Cohen', 'Chargeback fee', 1_500],
];

export function seedRefunds(db: DB, now = Date.now()): void {
  db.transaction(() => {
    const insert = db.prepare('INSERT INTO charges (id, customer_name, description, amount, currency, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    CHARGES.forEach(([name, desc, amount], i) =>
      insert.run(`ch_${(3_100_000 + i * 7919).toString(36)}`, name, desc, amount, 'USD', new Date(now - (i + 1) * 9 * 3_600_000).toISOString()),
    );
    const charges = db.prepare('SELECT id, amount FROM charges ORDER BY created_at DESC').all() as { id: string; amount: number }[];
    const u = (id: string) => asAppUser(db, id, 'refunds') as AppUser<RefundRole>;
    const [jordan, alex, sam, morgan] = ['u-jordan', 'u-alex', 'u-sam', 'u-morgan'].map(u);
    const req = (who: AppUser<RefundRole>, i: number, amount: number, reasonCode: string, note?: string) =>
      createRefund(db, who, { chargeId: charges[i].id, amount, reasonCode, note }).id;

    req(jordan, 1, 2_500, 'service_not_delivered', 'Replacement card never arrived');
    req(jordan, 5, 3_500, 'goodwill', 'First overdraft, long-time customer');
    req(alex, 8, 1_299, 'duplicate_charge', 'Charged twice on the same day');
    req(jordan, 4, 240_000, 'duplicate_charge', 'Payout correction was charged twice');

    const big = req(jordan, 0, 119_900, 'fraud_dispute', 'Customer did not authorize annual renewal');
    decideRefund(db, sam, big, 'approve', { note: 'Matches dispute ticket #4471' });

    const small = req(jordan, 2, 4_500, 'service_not_delivered', 'Wire returned by beneficiary bank');
    decideRefund(db, sam, small, 'approve');

    const twoStep = req(alex, 9, 185_000, 'goodwill', 'Loan withdrawn within rescission window');
    decideRefund(db, sam, twoStep, 'approve');
    decideRefund(db, morgan, twoStep, 'approve', { note: 'Rescission confirmed with lending ops' });

    const rejected = req(jordan, 10, 350, 'goodwill');
    decideRefund(db, sam, rejected, 'reject', { reasonCode: 'outside_policy', note: 'ATM fees are disclosed and non-refundable' });
  })();
}
