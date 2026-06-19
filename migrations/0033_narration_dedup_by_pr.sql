-- Switch narration dedup unit from trigger_event_id → PR identity.
--
-- Migration 0032 added a UNIQUE INDEX on (owner_id, type, trigger_event_id).
-- That catches the same trigger event being re-narrated, but GitHub
-- redelivers webhooks (auto-retry, network blips, ...) and each delivery
-- becomes a SEPARATE `github:pr:merged` event row with a fresh delivery_id
-- — and therefore a fresh narrative row. Production has at least one PR
-- (n1healthcare/forge-runner#436) with 4 narratives from 4 redelivered
-- webhooks, all minutes apart.
--
-- "One narrative per PR" is the right dedup unit. We index on
--   (owner_id, repo, type, pr_number)
-- where pr_number is denormalized into the narrative payload at insert
-- time. This survives unlimited redeliveries AND any future reconcile
-- pass that minted a fresh trigger event for an already-narrated PR.
--
-- Steps:
--   1. Backfill `pr_number` into every narrative + release_notes payload
--      by joining to its trigger event (`json_extract(t.payload_json,
--      '$.pr.number')`).
--   2. Drop the trigger_event_id index from migration 0032.
--   3. Re-dedupe by (owner_id, repo, type, pr_number) — same precedence
--      rule as 0031 / 0032 (non-fallback wins, then smallest id).
--   4. Create the PR-identity UNIQUE INDEX.

-- Step 1: backfill pr_number into the narration payload.
-- json_set adds (or replaces) a key at the given path — universally
-- supported in SQLite's json1 module, no extension required.
UPDATE events
   SET payload_json = json_set(
         payload_json,
         '$.pr_number',
         (SELECT CAST(json_extract(t.payload_json, '$.pr.number') AS INTEGER)
            FROM events t
           WHERE t.id = CAST(json_extract(events.payload_json, '$.trigger_event_id') AS INTEGER))
       )
 WHERE type IN ('narrative', 'release_notes')
   AND json_extract(payload_json, '$.trigger_event_id') IS NOT NULL
   AND json_extract(payload_json, '$.pr_number') IS NULL;

-- Step 2: drop the old trigger_event_id-based index.
DROP INDEX IF EXISTS idx_narration_dedup;

-- Step 3: re-dedupe by PR identity now that pr_number is populated.
-- Same precedence as 0031: prefer non-fallback rows, then smallest id.
DELETE FROM events
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY owner_id, repo, type,
                          CAST(json_extract(payload_json, '$.pr_number') AS INTEGER)
             ORDER BY
               CASE WHEN json_extract(payload_json, '$.model') = 'fallback' THEN 1 ELSE 0 END,
               id ASC
           ) AS rn
    FROM events
    WHERE type IN ('narrative', 'release_notes')
      AND json_extract(payload_json, '$.pr_number') IS NOT NULL
  )
  WHERE rn > 1
);

-- Step 4: PR-identity UNIQUE INDEX. Partial so it ignores other event
-- types and any narration rows still missing pr_number (defensive).
CREATE UNIQUE INDEX idx_narration_pr_dedup
  ON events (
    owner_id,
    repo,
    type,
    CAST(json_extract(payload_json, '$.pr_number') AS INTEGER)
  )
  WHERE type IN ('narrative', 'release_notes')
    AND json_extract(payload_json, '$.pr_number') IS NOT NULL;
