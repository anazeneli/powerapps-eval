import { REFUND_STATUSES } from '@kyc/shared';

const statusList = REFUND_STATUSES.map((s) => `'${s}'`).join(',');

export const REFUNDS_SCHEMA = `
CREATE TABLE IF NOT EXISTS charges (
  id            TEXT PRIMARY KEY,
  customer_name TEXT NOT NULL,
  description   TEXT NOT NULL,
  amount        INTEGER NOT NULL CHECK (amount > 0),
  currency      TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS refunds (
  id                  TEXT PRIMARY KEY,
  charge_id           TEXT NOT NULL REFERENCES charges(id),
  amount              INTEGER NOT NULL CHECK (amount > 0),
  reason_code         TEXT NOT NULL,
  note                TEXT,
  status              TEXT NOT NULL CHECK (status IN (${statusList})),
  requester_id        TEXT NOT NULL REFERENCES users(id),
  first_approver_id   TEXT REFERENCES users(id),
  second_approver_id  TEXT REFERENCES users(id),
  reject_reason_code  TEXT,
  processor_refund_id TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  -- Maker-checker backstops: nobody approves their own request, and two approvals come from two people.
  CHECK (first_approver_id IS NULL OR first_approver_id <> requester_id),
  CHECK (second_approver_id IS NULL OR (second_approver_id <> requester_id AND second_approver_id <> first_approver_id)),
  CHECK (status <> 'issued' OR processor_refund_id IS NOT NULL)
);

-- Stands in for the payment processor (e.g. Stripe), keyed by the idempotency key we send it.
CREATE TABLE IF NOT EXISTS processor_refunds (
  idempotency_key TEXT PRIMARY KEY,
  id              TEXT NOT NULL UNIQUE,
  charge_id       TEXT NOT NULL,
  amount          INTEGER NOT NULL,
  created_at      TEXT NOT NULL
);
`;
