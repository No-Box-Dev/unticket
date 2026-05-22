CREATE TABLE IF NOT EXISTS op_failures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT NOT NULL,
  op TEXT NOT NULL,
  delivery_id TEXT,
  error TEXT NOT NULL,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS op_failures_owner_time ON op_failures(owner_id, occurred_at DESC);
