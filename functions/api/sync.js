import { getCtx, jsonResponse, errorResponse } from "../lib/db";
import { syncInit, syncRepo } from "../lib/github-sync";

// POST /api/sync — cursor-based sync (one repo per call)
// No cursor → run syncInit, return first repo as cursor
// cursor=repoName → sync that repo, return next repo as cursor
// No more repos → { done: true }
export async function onRequestPost(context) {
  const { orgId, orgLogin, token } = getCtx(context);
  const url = new URL(context.request.url);
  const cursor = url.searchParams.get("cursor");
  const force = url.searchParams.get("force") === "true";

  try {
    if (!cursor) {
      // Phase 1: init (repos list, members, config migration)
      const repoNames = await syncInit(context.env.DB, token, orgId, orgLogin);

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

    // Phase 2: sync one repo
    await syncRepo(context.env.DB, token, orgId, orgLogin, cursor, force);

    // Find next repo
    const repoRows = await context.env.DB
      .prepare("SELECT name FROM repos WHERE org_id = ? ORDER BY name")
      .bind(orgId)
      .all();
    const repoNames = repoRows.results.map((r) => r.name);
    const currentIdx = repoNames.indexOf(cursor);
    const nextRepo = currentIdx >= 0 && currentIdx < repoNames.length - 1
      ? repoNames[currentIdx + 1]
      : null;

    if (!nextRepo) {
      return jsonResponse({ done: true, lastRepo: cursor });
    }

    return jsonResponse({
      done: false,
      cursor: nextRepo,
      synced: cursor,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed";
    const stack = e instanceof Error ? e.stack : undefined;
    console.error("[sync] error:", message, stack);
    return errorResponse("Sync failed. Please try again later.", 500);
  }
}

// GET /api/sync — check sync freshness
export async function onRequestGet(context) {
  const { orgId } = getCtx(context);

  const rows = await context.env.DB
    .prepare("SELECT resource, last_synced, etag FROM sync_state WHERE org_id = ?")
    .bind(orgId)
    .all();

  const syncMap = {};
  for (const row of rows.results) {
    syncMap[row.resource] = { lastSynced: row.last_synced, etag: row.etag };
  }

  // Check staleness: use MIN(last_synced) across all resources
  const oldest = await context.env.DB
    .prepare("SELECT MIN(last_synced) as oldest FROM sync_state WHERE org_id = ?")
    .bind(orgId)
    .first();

  const oldestTime = oldest?.oldest ? new Date(oldest.oldest).getTime() : 0;
  const isStale = !oldest?.oldest ||
    (Date.now() - oldestTime > 5 * 60 * 1000);

  return jsonResponse({
    isStale,
    lastSync: oldest?.oldest ?? null,
    resources: syncMap,
  });
}
