-- Indexes for paginated + filtered issue queries
CREATE INDEX IF NOT EXISTS idx_issues_state_updated ON issues (org_id, state, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_issues_closed_at ON issues (org_id, closed_at);
