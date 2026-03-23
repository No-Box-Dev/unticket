-- Pending OAuth tokens for one-time exchange (replaces token-in-URL-fragment pattern)
CREATE TABLE IF NOT EXISTS pending_tokens (
  code TEXT PRIMARY KEY,
  encrypted_token TEXT NOT NULL,
  csrf_state TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Auto-cleanup: tokens older than 5 minutes are invalid
CREATE INDEX IF NOT EXISTS idx_pending_tokens_created ON pending_tokens(created_at);
