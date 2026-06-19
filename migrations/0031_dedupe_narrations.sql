-- One-off cleanup of duplicate narrative + release_notes rows.
--
-- narrateEvent never had the SELECT-by-trigger_event_id idempotency check
-- that narrateReleaseNotes added in PR #348. Result: every time an admin
-- clicked Posts Backfill (and every reconcile pass + queue replay), the
-- narrator inserted a fresh narrative row for the same trigger event. As
-- of this migration the count was 912 duplicate narratives on prod (638
-- in n1healthcare, 274 in No-Box-Dev) and 3 race-window release_notes
-- duplicates.
--
-- Keep one row per (owner_id, type, trigger_event_id):
--   1. Prefer model != 'fallback' (a real LLM call beats the raw-summary
--      fallback that fires when the LLM was down)
--   2. Among equals, keep the smallest id (oldest = original real-time
--      narration; later rows are backfill duplicates)
--
-- Rows without a trigger_event_id are left alone — they can't be matched
-- against any other row in this scheme, so they aren't duplicates by
-- definition.

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
