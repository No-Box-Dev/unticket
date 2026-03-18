-- Indexes for pull_requests queries (state + updated_at filtering)
CREATE INDEX IF NOT EXISTS idx_prs_state_updated ON pull_requests (org_id, state, updated_at DESC);

-- Index for PR author filtering
CREATE INDEX IF NOT EXISTS idx_prs_author ON pull_requests (org_id, author);

-- Index for issue repo filtering
CREATE INDEX IF NOT EXISTS idx_issues_repo ON issues (org_id, repo);

-- Index for PR repo filtering
CREATE INDEX IF NOT EXISTS idx_prs_repo ON pull_requests (org_id, repo);

-- Index for features queries
CREATE INDEX IF NOT EXISTS idx_features_state ON features (org_id, state);
