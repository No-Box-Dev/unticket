-- Engineer-stats aggregation (functions/api/engineer-stats.ts).
-- The "issues closed by member" count runs on every People-tab load and grows
-- with closed-issue history. Without this index it GROUP BYs closed_by via a
-- temp b-tree; with it the query is a plain indexed SEARCH (verified via
-- EXPLAIN QUERY PLAN). The PR aggregations are already covered by idx_prs_author.
CREATE INDEX IF NOT EXISTS idx_issues_closed_by ON issues (org_id, closed_by);
