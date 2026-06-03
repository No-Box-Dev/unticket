import { getCtx, jsonResponse, errorResponse } from "../lib/db";
import { getActiveRepoNames } from "../lib/inactive-repos";
import { reconcileRepoEvents } from "../lib/event-reconcile";

// POST /api/sync-events — admin-triggered backfill of the `events` table.
// Cursor-batched (one repo per call) so a large org doesn't blow past the
// Cloudflare Pages Functions CPU limit.
//   no cursor   → returns first repo + full repoList
//   ?cursor=<r> → reconciles that repo, returns next or { done: true }
//
// Looks back 30 days — wider than the cron's 48h — so an admin clicking
// "fix my gap" can recover events that predate the cron's window.
const MANUAL_LOOKBACK_HOURS = 24 * 30;

// One backfill run per org per day. The 30-day reconcile fans out across every
// active repo, hits the GitHub events API, and can narrate PR-merge events — so
// without a gate a tenant could repeatedly run it up. Persisted in sync_state
// (not an in-memory Map) so the cooldown holds across Worker isolates.
const BACKFILL_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const BACKFILL_RESOURCE = "__events_backfill_dedupe";

async function getLastBackfill(db, orgId) {
  const row = await db
    .prepare("SELECT last_synced FROM sync_state WHERE org_id = ? AND resource = ?")
    .bind(orgId, BACKFILL_RESOURCE)
    .first();
  if (!row?.last_synced) return 0;
  const ms = new Date(row.last_synced).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

async function markBackfill(db, orgId) {
  await db
    .prepare(
      `INSERT INTO sync_state (org_id, resource, last_synced)
       VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
       ON CONFLICT(org_id, resource) DO UPDATE SET
         last_synced = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`,
    )
    .bind(orgId, BACKFILL_RESOURCE)
    .run();
}

export async function onRequestPost(context) {
  const { orgId, orgLogin, token, isAdmin } = getCtx(context);
  if (!orgLogin) return errorResponse("Missing org context", 400);
  if (!isAdmin) return errorResponse("Admin required", 403);

  const url = new URL(context.request.url);
  const cursor = url.searchParams.get("cursor");

  try {
    if (!cursor) {
      // Rate-limit on the START of a run, but the cooldown is only stamped once
      // a run COMPLETES (see the done branch below). That way a run that fails
      // partway (network error, closed tab) doesn't lock the admin out for 24h —
      // they can retry. Cursor calls in an in-flight chain bypass this gate.
      const last = await getLastBackfill(context.env.DB, orgId);
      if (last && Date.now() - last < BACKFILL_COOLDOWN_MS) {
        const retryAfterSec = Math.ceil(
          (BACKFILL_COOLDOWN_MS - (Date.now() - last)) / 1000,
        );
        return new Response(
          JSON.stringify({
            error: "Event backfill is limited to once per day. Try again later.",
          }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": String(retryAfterSec),
            },
          },
        );
      }

      const repoNames = await getActiveRepoNames(context.env.DB, orgId, orgLogin);
      if (repoNames.length === 0) {
        return jsonResponse({ done: true, repos: 0 });
      }
      return jsonResponse({
        done: false,
        cursor: repoNames[0],
        repos: repoNames.length,
        repoList: repoNames,
      });
    }

    const counts = await reconcileRepoEvents(context.env, context.env.DB, {
      orgId,
      orgLogin,
      repo: cursor,
      token,
      lookbackHours: MANUAL_LOOKBACK_HOURS,
    });

    // Compute next cursor from the same active-repos list the initial call
    // used, so a repo added mid-run doesn't shift the cursor.
    const repoNames = await getActiveRepoNames(context.env.DB, orgId, orgLogin);
    const currentIdx = repoNames.indexOf(cursor);
    const nextRepo =
      currentIdx >= 0 && currentIdx < repoNames.length - 1
        ? repoNames[currentIdx + 1]
        : null;

    if (!nextRepo) {
      // Run finished — stamp the cooldown now (not at start), so only a
      // completed backfill counts against the once-per-day limit.
      await markBackfill(context.env.DB, orgId);
      return jsonResponse({ done: true, lastRepo: cursor, counts });
    }
    return jsonResponse({
      done: false,
      cursor: nextRepo,
      synced: cursor,
      counts,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Event backfill failed";
    const stack = e instanceof Error ? e.stack : undefined;
    console.error("[sync-events] error:", message, stack);
    return errorResponse("Event backfill failed. Please try again later.", 500);
  }
}
