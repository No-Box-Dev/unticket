-- Default-branch commits used by the People contribution statistics.
-- A commit is stored once per repository; author attribution comes from
-- GitHub's resolved user login rather than an unverified Git author name.
CREATE TABLE IF NOT EXISTS github_commits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  repo TEXT NOT NULL,
  sha TEXT NOT NULL,
  author TEXT,
  author_avatar TEXT,
  authored_at TEXT,
  committed_at TEXT,
  html_url TEXT,
  message TEXT,
  UNIQUE(org_id, repo, sha)
);

CREATE INDEX IF NOT EXISTS idx_github_commits_author_date
  ON github_commits(org_id, author, authored_at);

CREATE INDEX IF NOT EXISTS idx_github_commits_repo_date
  ON github_commits(org_id, repo, authored_at);
