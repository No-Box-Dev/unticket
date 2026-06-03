-- Operator kill-switch for abusive or non-compliant tenants.
--
-- suspended_at: when set (non-NULL), the auth middleware rejects every API
-- request for the org with 403 before any work runs. NULL = active. Suspension
-- is a manual ops action (no UI) — set it directly:
--   UPDATE orgs SET suspended_at = datetime('now') WHERE github_login = '<org>';
-- and clear it to restore access:
--   UPDATE orgs SET suspended_at = NULL WHERE github_login = '<org>';
ALTER TABLE orgs ADD COLUMN suspended_at TEXT;
