CREATE TABLE IF NOT EXISTS pr_match_attempts (
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  pr_repo TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  attempted_at TEXT NOT NULL DEFAULT (datetime('now')),
  result TEXT NOT NULL,
  feature_number INTEGER,
  PRIMARY KEY (org_id, pr_repo, pr_number)
);
