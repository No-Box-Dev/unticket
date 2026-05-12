-- Cron reconciliation observability (Slice 3 of webhook-first sync plan).
--
-- reconcile_runs: one row per org per cron tick. Captures duration + error
-- so we can graph reconcile health, see which orgs are slow, and detect
-- runs that never finished (started_at set, finished_at null past the
-- expected window). The cron skips an org if a row from <25 min ago is
-- still unfinished — prevents two ticks racing on the same org.
--
-- installations.health_status: short tag set by reconcile when an org
-- looks unhealthy. Today we set 'silent' if no events arrived for 24h+
-- AND reconcile saw nothing changing. NULL means healthy.

CREATE TABLE IF NOT EXISTS reconcile_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id       INTEGER NOT NULL,
  started_at   TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at  TEXT,
  duration_ms  INTEGER,
  error        TEXT
);
CREATE INDEX IF NOT EXISTS idx_reconcile_runs_org ON reconcile_runs(org_id, started_at DESC);

ALTER TABLE installations ADD COLUMN health_status TEXT;
