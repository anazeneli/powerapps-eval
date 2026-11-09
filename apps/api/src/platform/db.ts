import Database from 'better-sqlite3';
import { KYC_SCHEMA } from '../apps/kyc/schema.js';
import { REFUNDS_SCHEMA } from '../apps/refunds/schema.js';
import { FLAGS_SCHEMA } from '../apps/flags/schema.js';

export type DB = Database.Database;

const PLATFORM_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  title      TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- One role per person per app. Apps declare their roles in the shared catalog.
CREATE TABLE IF NOT EXISTS app_roles (
  user_id    TEXT NOT NULL REFERENCES users(id),
  app_id     TEXT NOT NULL,
  role       TEXT NOT NULL,
  granted_by TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  PRIMARY KEY (user_id, app_id)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT NOT NULL,
  app_id      TEXT NOT NULL,
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
CREATE INDEX IF NOT EXISTS audit_events_app ON audit_events(app_id);

-- Append-only: nobody, including the app, can edit or delete audit history.
CREATE TRIGGER IF NOT EXISTS audit_events_no_update BEFORE UPDATE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_events_no_delete BEFORE DELETE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;

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
`;

export function openDb(file = ':memory:'): DB {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  for (const schema of [PLATFORM_SCHEMA, KYC_SCHEMA, REFUNDS_SCHEMA, FLAGS_SCHEMA]) db.exec(schema);
  return db;
}
