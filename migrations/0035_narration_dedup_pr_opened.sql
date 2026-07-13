-- Extend the narration dedup UNIQUE INDEX from migration 0033 to also cover
-- the new `pr_narrative` type (written by narratePrOpened when a PR opens,
-- shown in the PRs feed).
--
-- SQLite can't ALTER an index's WHERE predicate, so we drop and re-create.
-- Same shape as 0033 — (owner_id, repo, type, pr_number) — just an extra
-- type in the partial predicate.

DROP INDEX IF EXISTS idx_narration_pr_dedup;

CREATE UNIQUE INDEX idx_narration_pr_dedup
  ON events (
    owner_id,
    repo,
    type,
    CAST(json_extract(payload_json, '$.pr_number') AS INTEGER)
  )
  WHERE type IN ('narrative', 'release_notes', 'pr_narrative')
    AND json_extract(payload_json, '$.pr_number') IS NOT NULL;
