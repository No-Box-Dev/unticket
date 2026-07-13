-- Add merged_by so engineer-stats can count "PRs I merged for someone else".
-- Populated by the webhook path (pull_request.closed with merged=true carries
-- pull_request.merged_by.login). The list-Pulls API used by the bootstrap sync
-- does NOT return merged_by, so historical merges stay NULL until an optional
-- per-PR backfill runs.

ALTER TABLE pull_requests ADD COLUMN merged_by TEXT;

-- Partial index — most rows are NULL, so a partial index stays tiny and still
-- serves the "SELECT merged_by, COUNT(*) ... GROUP BY merged_by" aggregation.
CREATE INDEX IF NOT EXISTS idx_prs_merged_by
  ON pull_requests(org_id, merged_by, repo)
  WHERE merged_by IS NOT NULL;

-- Covers the approvals-given aggregation in engineer-stats. Events uses `org`
-- (login string) not `org_id`, so filter by org+type+repo — same shape as the
-- existing idx_events_type but composite for the tighter filter.
CREATE INDEX IF NOT EXISTS idx_events_org_type_repo
  ON events(org, type, repo);
