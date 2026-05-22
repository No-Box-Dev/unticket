// Persistent record of background-operation failures.
//
// Things that happen inside `context.waitUntil(...)` finish AFTER the response
// is returned, so any thrown error only ever reaches `console.error`. That
// makes them invisible from the UI: a webhook returns 200, narration silently
// fails, and the only signal is a fallback post days later.
//
// `recordFailure` writes the error to D1 so admins can see what's been
// breaking out-of-band. It MUST swallow its own errors — if the failure log
// itself can fail, we don't want it to mask the original problem or escape
// into the response path.

export async function recordFailure(db, { ownerId, op, deliveryId, error }) {
  if (!db || !ownerId || !op) return;
  const message =
    error instanceof Error
      ? error.stack ?? error.message
      : String(error ?? "");
  try {
    await db
      .prepare(
        `INSERT INTO op_failures (owner_id, op, delivery_id, error)
         VALUES (?, ?, ?, ?)`
      )
      .bind(ownerId, op, deliveryId ?? null, message.slice(0, 4000))
      .run();
  } catch (err) {
    console.error("[op_failures] failed to record:", err);
  }
}
