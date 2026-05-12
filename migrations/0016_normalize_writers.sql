-- Continuation of migration 0014: catch the remaining TEXT timestamp columns
-- whose writers were still using `datetime('now')` / `CURRENT_TIMESTAMP`. Same
-- format target: `YYYY-MM-DDTHH:MM:SSZ`. Idempotent via `NOT LIKE '%T%'`.
--
-- Schema-level column defaults are left as-is because every writer in code
-- now passes an explicit value; defaults only fire on INSERTs that omit the
-- column, and our INSERTs are exhaustive.

UPDATE sessions
   SET updated_at = REPLACE(updated_at, ' ', 'T') || 'Z'
 WHERE updated_at IS NOT NULL
   AND updated_at NOT LIKE '%T%';

UPDATE pending_tokens
   SET created_at = REPLACE(created_at, ' ', 'T') || 'Z'
 WHERE created_at IS NOT NULL
   AND created_at NOT LIKE '%T%';

UPDATE config
   SET updated_at = REPLACE(updated_at, ' ', 'T') || 'Z'
 WHERE updated_at IS NOT NULL
   AND updated_at NOT LIKE '%T%';

UPDATE actors
   SET created_at = REPLACE(created_at, ' ', 'T') || 'Z'
 WHERE created_at IS NOT NULL
   AND created_at NOT LIKE '%T%';

UPDATE actors
   SET updated_at = REPLACE(updated_at, ' ', 'T') || 'Z'
 WHERE updated_at IS NOT NULL
   AND updated_at NOT LIKE '%T%';

UPDATE gh_users
   SET synced_at = REPLACE(synced_at, ' ', 'T') || 'Z'
 WHERE synced_at IS NOT NULL
   AND synced_at NOT LIKE '%T%';

UPDATE projects
   SET updated_at = REPLACE(updated_at, ' ', 'T') || 'Z'
 WHERE updated_at IS NOT NULL
   AND updated_at NOT LIKE '%T%';

UPDATE reconcile_runs
   SET started_at = REPLACE(started_at, ' ', 'T') || 'Z'
 WHERE started_at IS NOT NULL
   AND started_at NOT LIKE '%T%';

UPDATE reconcile_runs
   SET finished_at = REPLACE(finished_at, ' ', 'T') || 'Z'
 WHERE finished_at IS NOT NULL
   AND finished_at NOT LIKE '%T%';

UPDATE orgs
   SET bootstrapped_at = REPLACE(bootstrapped_at, ' ', 'T') || 'Z'
 WHERE bootstrapped_at IS NOT NULL
   AND bootstrapped_at NOT LIKE '%T%';

UPDATE repos
   SET archived_at = REPLACE(archived_at, ' ', 'T') || 'Z'
 WHERE archived_at IS NOT NULL
   AND archived_at NOT LIKE '%T%';

-- Plaintext-token cleanup (paired with crypto fallback removal in code):
-- encrypted_token now MUST be `<iv-hex>:<cipher-hex>`. Any legacy plaintext
-- row would fail decrypt; drop them so users get a clean re-auth instead of
-- a 500. Sessions are recreated on next login; pending_tokens are 5-min TTL
-- exchange codes that nobody is mid-flight on.
DELETE FROM sessions WHERE encrypted_token NOT LIKE '%:%';
DELETE FROM pending_tokens WHERE encrypted_token NOT LIKE '%:%';
