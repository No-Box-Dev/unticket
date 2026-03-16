CREATE TABLE IF NOT EXISTS pr_feature_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  feature_number INTEGER NOT NULL,
  pr_repo TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(org_id, feature_number, pr_repo, pr_number)
);
CREATE INDEX idx_pfl_feature ON pr_feature_links(org_id, feature_number);
CREATE INDEX idx_pfl_pr ON pr_feature_links(org_id, pr_repo, pr_number);
