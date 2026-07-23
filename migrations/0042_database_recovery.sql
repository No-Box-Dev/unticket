-- Durable, operator-requested GitHub recovery. The cron Worker enumerates
-- every repository accessible to each installation and processes one repo at
-- a time, making a full recovery resumable and observable.
CREATE TABLE IF NOT EXISTS database_recovery_requests (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  status         TEXT NOT NULL DEFAULT 'pending',
  requested_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  started_at     TEXT,
  completed_at   TEXT,
  repos_total    INTEGER NOT NULL DEFAULT 0,
  repos_done     INTEGER NOT NULL DEFAULT 0,
  repos_failed   INTEGER NOT NULL DEFAULT 0,
  error          TEXT
);

CREATE TABLE IF NOT EXISTS database_recovery_repos (
  request_id       INTEGER NOT NULL REFERENCES database_recovery_requests(id),
  installation_id INTEGER NOT NULL,
  org_id           INTEGER NOT NULL REFERENCES orgs(id),
  owner_login      TEXT NOT NULL,
  repo             TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending',
  attempts         INTEGER NOT NULL DEFAULT 0,
  started_at       TEXT,
  completed_at     TEXT,
  prs_before       INTEGER,
  prs_after        INTEGER,
  issues_before    INTEGER,
  issues_after     INTEGER,
  error            TEXT,
  PRIMARY KEY (request_id, installation_id, owner_login, repo)
);

CREATE INDEX IF NOT EXISTS idx_database_recovery_repos_pending
  ON database_recovery_repos (request_id, status, owner_login, repo);
