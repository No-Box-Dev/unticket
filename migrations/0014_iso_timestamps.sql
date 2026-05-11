-- Normalize space-format SQLite timestamps to ISO 8601 with trailing Z.
--
-- Background: `datetime('now')` and `CURRENT_TIMESTAMP` produce
-- `YYYY-MM-DD HH:MM:SS` (space, no Z). GitHub's `?since=` rejects that
-- format (silently returns 0 items), and Safari's `new Date(...)` parser
-- treats it as Invalid Date. Standardize on `YYYY-MM-DDTHH:MM:SSZ`
-- everywhere so values round-trip cleanly through both.
--
-- Writers in code switch to `strftime('%Y-%m-%dT%H:%M:%SZ', 'now')` in
-- the same PR. Guarded with `NOT LIKE '%T%'` so the migration is
-- idempotent and skips rows already in ISO form (e.g. repos.pushed_at
-- values copied from GitHub responses).

UPDATE sync_state
   SET last_synced = REPLACE(last_synced, ' ', 'T') || 'Z'
 WHERE last_synced IS NOT NULL
   AND last_synced NOT LIKE '%T%';

UPDATE events
   SET created_at = REPLACE(created_at, ' ', 'T') || 'Z'
 WHERE created_at IS NOT NULL
   AND created_at NOT LIKE '%T%';

UPDATE orgs
   SET last_event_at = REPLACE(last_event_at, ' ', 'T') || 'Z'
 WHERE last_event_at IS NOT NULL
   AND last_event_at NOT LIKE '%T%';

UPDATE repos
   SET pushed_at = REPLACE(pushed_at, ' ', 'T') || 'Z'
 WHERE pushed_at IS NOT NULL
   AND pushed_at NOT LIKE '%T%';
