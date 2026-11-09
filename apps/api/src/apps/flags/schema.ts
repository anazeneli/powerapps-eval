export const FLAGS_SCHEMA = `
CREATE TABLE IF NOT EXISTS flags (
  key         TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  owner       TEXT NOT NULL,
  critical    INTEGER NOT NULL DEFAULT 0,
  dev         INTEGER NOT NULL DEFAULT 0,
  staging     INTEGER NOT NULL DEFAULT 0,
  prod        INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS flag_changes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  flag_key     TEXT NOT NULL REFERENCES flags(key),
  env          TEXT NOT NULL CHECK (env IN ('dev','staging','prod')),
  enabled      INTEGER NOT NULL,
  reason       TEXT NOT NULL,
  requested_by TEXT NOT NULL REFERENCES users(id),
  status       TEXT NOT NULL CHECK (status IN ('pending','approved','rejected')),
  decided_by   TEXT REFERENCES users(id),
  created_at   TEXT NOT NULL,
  decided_at   TEXT,
  CHECK (decided_by IS NULL OR decided_by <> requested_by)
);
CREATE UNIQUE INDEX IF NOT EXISTS flag_changes_one_pending ON flag_changes(flag_key) WHERE status = 'pending';
`;
