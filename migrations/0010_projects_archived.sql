-- Platform-level archive flag on projects (NoxLink-style narrator overlay).
-- Distinct from GitHub's repo.archived: this is a user-controlled "make it
-- inactive on the platform" toggle. Archived projects are excluded from
-- sync, from issue/PR queries, and from the active narrator scope.

ALTER TABLE projects ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN archived_at TEXT;
CREATE INDEX IF NOT EXISTS idx_projects_archived ON projects(owner_id, archived);
