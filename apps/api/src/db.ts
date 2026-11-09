import Database from 'better-sqlite3';
import { CASE_STATUSES } from '@kyc/shared';

export type DB = Database.Database;

const statusList = CASE_STATUSES.map((s) => `'${s}'`).join(',');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('analyst','senior_reviewer','compliance_admin'))
);

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

CREATE TABLE IF NOT EXISTS audit_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT NOT NULL,
  actor_id    TEXT NOT NULL,
  actor_role  TEXT NOT NULL,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  changes     TEXT,
  reason      TEXT,
  request_id  TEXT,
  prev_hash   TEXT NOT NULL,
  hash        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_events_entity ON audit_events(entity_type, entity_id);

-- Chain head, written in the same transaction as each audit row. Lets verification detect a
-- truncated tail. It only moves forward. Production would also anchor it in write-once storage.
CREATE TABLE IF NOT EXISTS audit_chain_head (
  id      INTEGER PRIMARY KEY CHECK (id = 1),
  last_id INTEGER NOT NULL,
  hash    TEXT NOT NULL,
  count   INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS audit_chain_head_forward_only BEFORE UPDATE ON audit_chain_head
WHEN NEW.last_id <= OLD.last_id
BEGIN SELECT RAISE(ABORT, 'audit chain head can only move forward'); END;
CREATE TRIGGER IF NOT EXISTS audit_chain_head_no_delete BEFORE DELETE ON audit_chain_head
BEGIN SELECT RAISE(ABORT, 'audit chain head cannot be deleted'); END;

-- Append-only: nobody, including the app, can edit or delete audit history.
CREATE TRIGGER IF NOT EXISTS audit_events_no_update BEFORE UPDATE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_events_no_delete BEFORE DELETE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
`;

export function openDb(file = ':memory:'): DB {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}
