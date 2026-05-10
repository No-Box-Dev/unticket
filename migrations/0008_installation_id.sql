-- Track which GitHub App installation backs each org.
-- Populated when the App is installed on the org (handled by /api/auth/install + webhook installation events).
ALTER TABLE orgs ADD COLUMN installation_id INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS orgs_installation_id_unique ON orgs(installation_id) WHERE installation_id IS NOT NULL;
