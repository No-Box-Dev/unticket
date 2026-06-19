-- Newly-discovered repo flagging.
--
-- discovered_at:   set the first time syncRepos / installation_repositories.added
--                  inserts a row for this (org_id, name). Preserved on subsequent
--                  upserts via COALESCE so it remains "first seen at" forever.
-- acknowledged_at: NULL means an admin has not yet reviewed this repo. The
--                  NewRepoBanner, the TopNav dot, and Settings → Newly detected
--                  all read off this flag. Cleared (set to NULL) only via the
--                  migration backfill below — going forward, new repos always
--                  start NULL and admins acknowledge explicitly.
--
-- Backfill: every existing row gets both timestamps stamped to now, so the
-- banner doesn't shout at admins about every repo they already know about
-- the moment this ships.

ALTER TABLE repos ADD COLUMN discovered_at TEXT;
ALTER TABLE repos ADD COLUMN acknowledged_at TEXT;

UPDATE repos
   SET discovered_at   = COALESCE(discovered_at, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
       acknowledged_at = COALESCE(acknowledged_at, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

CREATE INDEX IF NOT EXISTS idx_repos_unacked
  ON repos (org_id) WHERE acknowledged_at IS NULL;
