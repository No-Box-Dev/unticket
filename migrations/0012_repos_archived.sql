-- Track GitHub repo lifecycle on the cached `repos` table.
--
-- archived_at: set when GitHub fires `repository.archived`. The webhook
-- coverage gap (Slice 2 of the webhook-first sync plan) closes this so
-- archived repos stop appearing in dashboards within seconds of the
-- archive happening, instead of waiting for the next reconciliation pass.
--
-- A NULL archived_at means "active". Renamed/transferred repos use
-- `removeRepo` instead so we don't keep dead rows around — there's
-- nothing for the user to do with a renamed repo besides delete it.

ALTER TABLE repos ADD COLUMN archived_at TEXT;
CREATE INDEX IF NOT EXISTS idx_repos_archived ON repos(org_id, archived_at);
