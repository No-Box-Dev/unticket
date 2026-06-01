// Event-table retention + R2 archival.
//
// The `events` table grows unbounded (one row per webhook/reconcile event) and
// the Live Activity feed only reads recent rows. This sweep archives rows older
// than RETENTION_DAYS to R2 as date-partitioned NDJSON, then deletes them from
// D1 — keeping the table (and D1's size budget) bounded. Archive-then-delete so
// a delete failure just re-archives the same batch next run (object overwrites).

export const RETENTION_DAYS = 90;
const BATCH_SIZE = 1000;
const MAX_BATCHES_PER_RUN = 20; // 20k rows/run cap so one tick can't run away

export async function archiveOldEvents(env, nowMs) {
  const bucket = env.EVENTS_ARCHIVE;
  if (!bucket) {
    console.warn("[unticket-cron] EVENTS_ARCHIVE bucket not bound; skipping event archival");
    return { archived: 0, skipped: true };
  }

  const cutoff = new Date(nowMs - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const runDate = new Date(nowMs).toISOString().slice(0, 10); // YYYY-MM-DD
  let total = 0;
  let batches = 0;

  for (; batches < MAX_BATCHES_PER_RUN; batches++) {
    // SELECT * is intentional here — the whole row is archived verbatim to NDJSON.
    const res = await env.DB
      .prepare("SELECT * FROM events WHERE created_at < ? ORDER BY id LIMIT ?")
      .bind(cutoff, BATCH_SIZE)
      .all();
    const rows = res.results ?? [];
    if (rows.length === 0) break;

    const maxId = rows[rows.length - 1].id;
    const minId = rows[0].id;
    const ndjson = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

    await bucket.put(`events/${runDate}/${minId}-${maxId}.ndjson`, ndjson, {
      httpMetadata: { contentType: "application/x-ndjson" },
    });

    // Deletes exactly the archived batch: ORDER BY id LIMIT N means every old
    // row with id <= maxId was selected, so this id+cutoff predicate matches it.
    await env.DB
      .prepare("DELETE FROM events WHERE id <= ? AND created_at < ?")
      .bind(maxId, cutoff)
      .run();

    total += rows.length;
    if (rows.length < BATCH_SIZE) break;
  }

  if (batches >= MAX_BATCHES_PER_RUN) {
    console.warn(`[unticket-cron] event archival hit per-run cap (${total} rows); more remain for the next run`);
  } else if (total > 0) {
    console.log(`[unticket-cron] archived + pruned ${total} event(s) older than ${RETENTION_DAYS}d`);
  }
  return { archived: total };
}
