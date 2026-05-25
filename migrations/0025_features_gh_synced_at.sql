-- Records the GitHub `updated_at` of the issue at the time D1 last mirrored
-- it. Lets the cron's syncFeatures distinguish "D1 has an unpushed local
-- change" (d1.updated_at > d1.gh_synced_at) from "GitHub moved since we
-- last pulled" (gh.updated_at > d1.gh_synced_at). Without this, every
-- cron tick blindly overwrote the local optimistic write when the inline
-- waitUntil PATCH had not yet completed (or had failed) — see the revert
-- bug in functions/api/features/[number].js's PATCH path.
--
-- Backfill: all existing rows are treated as currently in sync (the
-- previous behavior was GH-wins, so D1 == GH at this point).
ALTER TABLE features ADD COLUMN gh_synced_at TEXT;
UPDATE features SET gh_synced_at = updated_at WHERE gh_synced_at IS NULL;
