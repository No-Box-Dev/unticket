// Unticket reconciliation cron.
//
// Fires every 30 min. Walks every org with an active GitHub App
// installation and reconciles D1 against GitHub. Webhooks handle the
// fast path; this catches deletes, missed deliveries, and any drift
// that accumulates between events.
//
// See migrations/0013_reconcile_observability.sql for the
// `reconcile_runs` table this writes to.

import { reconcileOrg } from "./reconcile.js";

// Cap concurrent orgs per tick to keep GitHub API consumption bounded.
// Tune up once we measure real numbers.
const MAX_ORGS_PER_TICK = 10;

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runTick(env));
  },

  // Manual trigger for `wrangler dev --test-scheduled` and curl /__scheduled.
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/__scheduled") {
      ctx.waitUntil(runTick(env));
      return new Response("ok\n");
    }
    return new Response("not found", { status: 404 });
  },
};

async function runTick(env) {
  const db = env.DB;
  const orgs = await db
    .prepare(
      `SELECT id, github_login, installation_id
       FROM orgs
       WHERE installation_id IS NOT NULL AND bootstrapped_at IS NOT NULL
       ORDER BY id
       LIMIT ?`
    )
    .bind(MAX_ORGS_PER_TICK)
    .all();

  for (const org of orgs.results ?? []) {
    try {
      await reconcileOrg(env, db, org.id, org.github_login, org.installation_id);
    } catch (err) {
      console.error(
        `[unticket-cron] org=${org.github_login} reconcile failed:`,
        err?.message ?? err,
      );
    }
  }
}
