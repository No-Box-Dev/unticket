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

export async function onRequestPost(context) {
  const { orgId, orgLogin, token, isAdmin } = getCtx(context);
  if (!orgLogin) return errorResponse("Missing org context", 400);
  if (!isAdmin) return errorResponse("Admin required", 403);

  const url = new URL(context.request.url);
  const cursor = url.searchParams.get("cursor");

  try {
    if (!cursor) {
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
