-- Preserve repository lifecycle and the exact periods during which a repo was
-- included in Unticket. Historical analytics must not be rewritten when a
-- repo is archived, transferred, deleted, or later re-enabled.
ALTER TABLE repos ADD COLUMN retired_at TEXT;
ALTER TABLE repos ADD COLUMN retirement_reason TEXT;
ALTER TABLE repos ADD COLUMN transferred_to TEXT;

CREATE TABLE IF NOT EXISTS repo_tracking_periods (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id        INTEGER NOT NULL REFERENCES orgs(id),
  repo          TEXT NOT NULL,
  tracked_from  TEXT NOT NULL,
  tracked_until TEXT,
  ended_reason  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_repo_tracking_periods_history
  ON repo_tracking_periods (org_id, repo, tracked_from, tracked_until);

CREATE UNIQUE INDEX IF NOT EXISTS idx_repo_tracking_periods_open
  ON repo_tracking_periods (org_id, repo)
  WHERE tracked_until IS NULL;

-- Backfill one best-known period per existing repository.
--
-- Repositories auto-excluded at discovery have archive and discovery stamps
-- within five minutes and receive no period. Legacy rows can have
-- discovered_at later than archived_at because discovery tracking was added
-- after the archive feature; those were previously tracked and are retained.
INSERT INTO repo_tracking_periods (org_id, repo, tracked_from, tracked_until, ended_reason)
SELECT
  repo.org_id,
  repo.name,
  COALESCE(
    (SELECT MIN(pr.created_at) FROM pull_requests pr
     WHERE pr.org_id = repo.org_id AND pr.repo = repo.name),
    (SELECT MIN(issue.created_at) FROM issues issue
     WHERE issue.org_id = repo.org_id AND issue.repo = repo.name),
    repo.discovered_at,
    org.created_at
  ),
  CASE
    WHEN project.archived = 1 THEN project.archived_at
    WHEN repo.archived_at IS NOT NULL THEN repo.archived_at
    WHEN repo.retired_at IS NOT NULL THEN repo.retired_at
    ELSE NULL
  END,
  CASE
    WHEN project.archived = 1 THEN 'platform_archived'
    WHEN repo.archived_at IS NOT NULL THEN 'github_archived'
    WHEN repo.retired_at IS NOT NULL THEN repo.retirement_reason
    ELSE NULL
  END
FROM repos repo
JOIN orgs org ON org.id = repo.org_id
LEFT JOIN projects project
  ON project.owner_id = org.github_login AND project.repo = repo.name
WHERE repo.name != COALESCE(
  json_extract(
    (SELECT data FROM config WHERE org_id = repo.org_id AND key = 'settings'),
    '$.unticketRepo'
  ),
  'unticket'
)
AND NOT (
  project.archived = 1
  AND project.archived_at IS NOT NULL
  AND repo.discovered_at IS NOT NULL
  AND ABS((julianday(project.archived_at) - julianday(repo.discovered_at)) * 86400) <= 300
)
AND (
  COALESCE(
    (SELECT MIN(pr.created_at) FROM pull_requests pr
     WHERE pr.org_id = repo.org_id AND pr.repo = repo.name),
    (SELECT MIN(issue.created_at) FROM issues issue
     WHERE issue.org_id = repo.org_id AND issue.repo = repo.name),
    repo.discovered_at,
    org.created_at
  )
  <
  COALESCE(project.archived_at, repo.archived_at, repo.retired_at, '9999-12-31T23:59:59Z')
);
