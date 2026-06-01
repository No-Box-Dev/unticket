// Shared contract for the durable background-work queue (`TASK_QUEUE`).
//
// Producer: functions/api/webhook.js enqueues instead of running work in
// `context.waitUntil` (which has no retry and is lost on failure/eviction).
// Consumer: the cron Worker's `queue()` handler (cron/src/index.js) drains it
// with retries + a dead-letter queue.
//
// Kept as plain JS because it's imported by both the JS webhook (Pages) and the
// JS cron Worker — avoids mixing a .ts module into the cron esbuild bundle.

export const TASK = {
  NARRATE: "narrate",        // { eventId }            -> narrateEvent(env, eventId)
  MATCH_PR: "match_pr",      // { orgId, repo, pr }    -> matchPRToFeatures(env, orgId, repo, pr)
  BOOTSTRAP: "bootstrap",    // { orgId, accountLogin, installationId }
  SYNC_REPO: "sync_repo",    // { orgId, accountLogin, installationId, repo }
};

// Enqueue a task. Never throws into the caller: a missing binding or transient
// send error is recorded to op_failures (admin-visible) so the webhook still
// returns 200 and the upserts it already did are preserved. The 30-min cron
// reconcile is the safety net that re-derives anything lost here.
export async function enqueueTask(env, ownerId, deliveryId, message) {
  try {
    // Stamp ownerId/deliveryId so the consumer can attribute terminal failures.
    await env.TASK_QUEUE.send({ ...message, ownerId, deliveryId });
  } catch (err) {
    console.error(`[unticket queue] enqueue ${message.type} failed:`, err?.message ?? err);
    const { recordFailure } = await import("./op-failures.js");
    await recordFailure(env.DB, {
      ownerId,
      op: `enqueue:${message.type}`,
      deliveryId,
      error: err,
    });
  }
}
