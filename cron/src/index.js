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

  await healOrgInstallationLinks(db);

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

// Self-heal: link `orgs` rows to their matching `installations` row and
// stamp `bootstrapped_at` whenever either is missing. Covers orgs that
// predate the bootstrap-on-install path (Slice 1) and any future row
// that lands in D1 without those columns set. Idempotent — once both
// columns are populated the row drops out of the WHERE clause.
async function healOrgInstallationLinks(db) {
  const res = await db
    .prepare(
      `UPDATE orgs SET
         installation_id = (SELECT installation_id FROM installations WHERE account_login = orgs.github_login),
         bootstrapped_at = COALESCE(bootstrapped_at, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
       WHERE (installation_id IS NULL OR bootstrapped_at IS NULL)
         AND EXISTS (SELECT 1 FROM installations WHERE account_login = orgs.github_login)`,
    )
    .run();
  const changed = res?.meta?.changes ?? 0;
  if (changed > 0) {
    console.log(`[unticket-cron] healed ${changed} org→installation link(s)`);
  }
}
