-- Unify Projects (spec_folders) into Features.
--
-- Under the new model, a Spec belongs to at most one Feature — the
-- GitHub-issue-backed feature (a row in `features`, keyed by (org_id, number)).
-- `spec_folders` and `spec.folder_id` are frozen: no new code path writes
-- them, but the rows stay so migration data isn't lost and rollback is safe.
--
-- Steps:
--   1. Add `feature_number` (nullable — every existing row starts unfiled)
--      and `legacy_folder_name` (a breadcrumb copy of the old folder name
--      so users can eyeball where each spec used to live and re-file it).
--   2. Copy the folder name into legacy_folder_name for every spec that
--      had a folder_id — one UPDATE with a correlated subquery.
--   3. Index (org_id, feature_number) for fast lookups of "specs for a
--      given feature" — Feature modal's Specs section reads by this.

ALTER TABLE specs ADD COLUMN feature_number INTEGER;
ALTER TABLE specs ADD COLUMN legacy_folder_name TEXT;

UPDATE specs
   SET legacy_folder_name = (
     SELECT name FROM spec_folders
      WHERE spec_folders.id = specs.folder_id
   )
 WHERE folder_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_specs_org_feature
  ON specs (org_id, feature_number)
  WHERE feature_number IS NOT NULL;
