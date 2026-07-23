-- Durable, server-side reconciliation of cached PR counts against GitHub's
-- search index. Requests are inserted by an operator/admin and consumed by the
-- cron Worker, which has the GitHub App installation credentials.
CREATE TABLE IF NOT EXISTS github_stats_audit_requests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id        INTEGER NOT NULL REFERENCES orgs(id),
  login         TEXT NOT NULL,
  start_month   TEXT NOT NULL,
  end_month     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  requested_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  completed_at  TEXT,
  error         TEXT
);

CREATE INDEX IF NOT EXISTS idx_github_stats_audit_requests_pending
  ON github_stats_audit_requests (status, requested_at);

CREATE TABLE IF NOT EXISTS github_stats_audit_months (
  request_id        INTEGER NOT NULL REFERENCES github_stats_audit_requests(id),
  org_id            INTEGER NOT NULL REFERENCES orgs(id),
  login             TEXT NOT NULL,
  month             TEXT NOT NULL,
  github_prs        INTEGER NOT NULL,
  cached_all_prs    INTEGER NOT NULL,
  cached_tracked_prs INTEGER NOT NULL,
  audited_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (request_id, month)
);

CREATE INDEX IF NOT EXISTS idx_github_stats_audit_months_lookup
  ON github_stats_audit_months (org_id, login, month);
