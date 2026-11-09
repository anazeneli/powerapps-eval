import { createHash } from 'node:crypto';
import type { DB } from '../../platform/db.js';

/**
 * Mock payment processor. In production this is the Stripe Refunds API, called with
 * Idempotency-Key = our refund id and metadata.refund_request_id, with webhooks persisted
 * and reconciled daily. Repeating a call with the same key returns the original refund.
 */
export function issueProcessorRefund(db: DB, req: { chargeId: string; amount: number; idempotencyKey: string }): string {
  const existing = db.prepare('SELECT id FROM processor_refunds WHERE idempotency_key = ?').get(req.idempotencyKey) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = `re_${createHash('sha256').update(req.idempotencyKey).digest('hex').slice(0, 20)}`;
  db.prepare('INSERT INTO processor_refunds (idempotency_key, id, charge_id, amount, created_at) VALUES (?, ?, ?, ?, ?)').run(
    req.idempotencyKey,
    id,
    req.chargeId,
    req.amount,
    new Date().toISOString(),
  );
  return id;
}
