-- Persist GitHub App user-to-server refresh tokens so 8-hour access-token
-- expiry doesn't force daily re-auth. Keyed by SHA-256(access_token) so the
-- client can hand back its (possibly expired) access token and we can find
-- the matching refresh token without ever decrypting unrelated rows.
--
-- One row per OAuth issuance, NOT per (org, user) like `sessions`: a single
-- refresh token can power activity across every org the user is a member of.
CREATE TABLE IF NOT EXISTS oauth_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  access_token_sha256 TEXT UNIQUE NOT NULL,
  github_login TEXT NOT NULL,
  encrypted_refresh_token TEXT,
  access_token_expires_at TEXT,
  refresh_token_expires_at TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS oauth_tokens_login ON oauth_tokens(github_login);
CREATE INDEX IF NOT EXISTS oauth_tokens_refresh_expires ON oauth_tokens(refresh_token_expires_at);
