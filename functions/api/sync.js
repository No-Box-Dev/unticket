import { getCtx, jsonResponse, errorResponse } from "../lib/db";
import { runFullSync } from "../lib/github-sync";
import { getSyncState } from "../lib/db";

// POST /api/sync — trigger full GitHub -> D1 sync
export async function onRequestPost(context) {
  const { orgId, orgLogin, token } = getCtx(context);

  try {
    const result = await runFullSync(context.env.DB, token, orgId, orgLogin);
    return jsonResponse({ ok: true, synced: result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed";
    return errorResponse(message, 500);
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

  // Check if any sync has happened
  const reposSync = await getSyncState(context.env.DB, orgId, "repos");
  const isStale = !reposSync ||
    (Date.now() - new Date(reposSync.lastSynced).getTime() > 5 * 60 * 1000);

  return jsonResponse({
    isStale,
    lastSync: reposSync?.lastSynced ?? null,
    resources: syncMap,
  });
}
