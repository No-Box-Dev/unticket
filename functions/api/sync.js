import { getCtx, jsonResponse, errorResponse } from "../lib/db";
import { syncInit, syncRepo, syncFeatures } from "../lib/github-sync";
import { filterInactive } from "../lib/inactive-repos";

// Rate limit for ?force=true (one full re-sync per org per 5 min). Persisted
// in sync_state so the cooldown holds across Worker isolates — a Map is
// per-isolate and would let parallel cold-starts bypass it.
const FORCE_SYNC_COOLDOWN_MS = 5 * 60 * 1000;
const FORCE_SYNC_RESOURCE = "__force_sync_dedupe";

async function getLastForceSync(db, orgId) {
  const row = await db
    .prepare("SELECT last_synced FROM sync_state WHERE org_id = ? AND resource = ?")
    .bind(orgId, FORCE_SYNC_RESOURCE)
    .first();
  if (!row?.last_synced) return 0;
  const ms = new Date(row.last_synced).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

async function markForceSync(db, orgId) {
  await db
    .prepare(
      `INSERT INTO sync_state (org_id, resource, last_synced)
       VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
       ON CONFLICT(org_id, resource) DO UPDATE SET
         last_synced = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`,
    )
    .bind(orgId, FORCE_SYNC_RESOURCE)
    .run();
}

// POST /api/sync — cursor-based sync (one repo per call)
// No cursor → run syncInit, return first repo as cursor
// cursor=repoName → sync that repo, return next repo as cursor
// No more repos → { done: true }
export async function onRequestPost(context) {
  const { orgId, orgLogin, token } = getCtx(context);
  const url = new URL(context.request.url);
  const cursor = url.searchParams.get("cursor");
  const force = url.searchParams.get("force") === "true";
  const scope = url.searchParams.get("scope");

  if (scope === "features") {
    try {
      await syncFeatures(context.env.DB, token, orgId, orgLogin);
      return jsonResponse({ done: true, scope: "features" });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Sync failed";
      console.error("[sync features] error:", message, e instanceof Error ? e.stack : undefined);
      return errorResponse("Feature sync failed. Please try again later.", 500);
    }
  }

  // Rate-limit ?force=true on initial call (no cursor) only.
  // Subsequent cursor calls in the same re-sync chain pass through.
  if (force && !cursor) {
    const last = await getLastForceSync(context.env.DB, orgId);
    if (last && Date.now() - last < FORCE_SYNC_COOLDOWN_MS) {
      const retryAfterSec = Math.ceil((FORCE_SYNC_COOLDOWN_MS - (Date.now() - last)) / 1000);
      return new Response(
        JSON.stringify({ error: "Force re-sync rate limited. Try again in a few minutes." }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(retryAfterSec),
          },
        },
      );
    }
    await markForceSync(context.env.DB, orgId);
  }

  try {
    if (!cursor) {
      // Phase 1: init (repos list, members, config migration)
      let repoNames = await syncInit(context.env.DB, token, orgId, orgLogin);

      // Filter out drafts (settings) and archived projects (platform inactive)
      repoNames = await filterInactive(context.env.DB, orgId, orgLogin, repoNames);

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

    // Find next repo (filtered by active repos)
    const repoRows = await context.env.DB
      .prepare("SELECT name FROM repos WHERE org_id = ? ORDER BY name")
      .bind(orgId).all();
    let repoNames = await filterInactive(
      context.env.DB,
      orgId,
      orgLogin,
      repoRows.results.map((r) => r.name),
    );
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
    .prepare("SELECT resource, last_synced, etag FROM sync_state WHERE org_id = ? AND resource != ?")
    .bind(orgId, FORCE_SYNC_RESOURCE)
    .all();

  const syncMap = {};
  for (const row of rows.results) {
    syncMap[row.resource] = { lastSynced: row.last_synced, etag: row.etag };
  }

  // Check staleness: use MIN(last_synced) across all real resources
  const oldest = await context.env.DB
    .prepare("SELECT MIN(last_synced) as oldest FROM sync_state WHERE org_id = ? AND resource != ?")
    .bind(orgId, FORCE_SYNC_RESOURCE)
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
