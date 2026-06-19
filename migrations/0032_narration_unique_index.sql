-- Atomic at-most-once dedup for narrative + release_notes rows.
--
-- Migration 0031 cleaned the historical 915 duplicates and PR #360 added a
-- SELECT-then-INSERT check in narrateEvent + narrateReleaseNotes. That
-- closes ~99% of cases but is still racy: when several narrate tasks fire
-- concurrently for the same trigger event (heavy queue load during Posts
-- Backfill), all can pass the SELECT and all can INSERT. Seen post-deploy:
-- trigger 32 picked up 4 fresh duplicates from a single backfill flush.
--
-- This migration:
--   1. Re-runs the same dedup as 0031 to catch anything inserted between
--      0031 running and this index landing (idempotent — no-op if clean).
--   2. Adds a partial UNIQUE INDEX on (owner_id, type, trigger_event_id),
--      so the constraint is enforced at write time. Combined with
--      INSERT ... ON CONFLICT DO NOTHING in narrator.js, this is true
--      at-most-once even under concurrent writers.
--
-- Why partial: events of types other than narrative/release_notes don't
-- carry a trigger_event_id, and we don't want to constrain them.

-- Step 1: re-dedupe (same logic as 0031, idempotent).
DELETE FROM events
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY owner_id, type,
                          CAST(json_extract(payload_json, '$.trigger_event_id') AS INTEGER)
             ORDER BY
               CASE WHEN json_extract(payload_json, '$.model') = 'fallback' THEN 1 ELSE 0 END,
               id ASC
           ) AS rn
    FROM events
    WHERE type IN ('narrative', 'release_notes')
      AND json_extract(payload_json, '$.trigger_event_id') IS NOT NULL
  )
  WHERE rn > 1
);

-- Step 2: unique-constrain the (owner_id, type, trigger_event_id) tuple
-- for narration rows. SQLite expression-indexes are stable since 3.9;
-- D1 ships with a newer version, so this is safe.
CREATE UNIQUE INDEX IF NOT EXISTS idx_narration_dedup
  ON events (
    owner_id,
    type,
    CAST(json_extract(payload_json, '$.trigger_event_id') AS INTEGER)
  )
  WHERE type IN ('narrative', 'release_notes')
    AND json_extract(payload_json, '$.trigger_event_id') IS NOT NULL;
