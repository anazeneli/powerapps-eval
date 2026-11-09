import { CASE_STATUSES } from '@kyc/shared';

const statusList = CASE_STATUSES.map((s) => `'${s}'`).join(',');

export const KYC_SCHEMA = `
CREATE TABLE IF NOT EXISTS cases (
  id                   TEXT PRIMARY KEY,
  customer_name        TEXT NOT NULL,
  date_of_birth        TEXT NOT NULL,
  country              TEXT NOT NULL,
  ssn                  TEXT NOT NULL,
  risk_level           TEXT NOT NULL CHECK (risk_level IN ('low','medium','high')),
  risk_score           INTEGER NOT NULL,
  vendor_checks        TEXT NOT NULL,
  status               TEXT NOT NULL CHECK (status IN (${statusList})),
  assignee_id          TEXT REFERENCES users(id),
  first_approver_id    TEXT REFERENCES users(id),
  second_approver_id   TEXT REFERENCES users(id),
  decision_reason_code TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  -- Four-eyes backstop: the database refuses a second approval by the first approver.
  CHECK (second_approver_id IS NULL OR second_approver_id <> first_approver_id),
  -- Every closed case carries a reason code.
  CHECK (status NOT IN ('approved','rejected') OR decision_reason_code IS NOT NULL)
);
`;
