import { getCtx, jsonResponse, errorResponse } from "../../lib/db";
import { validateBoardStages } from "../../lib/board-stages.js";
import { extractStatusFromLabels } from "../../lib/feature-issues.js";
import { hasUnsafePathSegment } from "../../lib/specs.js";

const VALID_KEYS = ["features", "people", "settings"];

const DEFAULTS = {
  features: [],
  people: [],
  settings: null,
};

// GET /api/config/:key
export async function onRequestGet(context) {
  const key = context.params.key;
  if (!VALID_KEYS.includes(key)) {
    return errorResponse(`Invalid config key: ${key}`, 400);
  }

  const { orgId } = getCtx(context);
  const row = await context.env.DB
    .prepare("SELECT data FROM config WHERE org_id = ? AND key = ?")
    .bind(orgId, key)
    .first();

  if (!row) {
    return jsonResponse(DEFAULTS[key]);
  }

  try {
    return jsonResponse(JSON.parse(row.data));
  } catch (err) {
    // Returning the default silently masked real corruption — drafts
    // re-appeared, custom unticketRepo names reverted to "unticket".
    // Fail loud so the user sees a clear error and fixes the row.
    console.error(`[unticket] Corrupt config data for key "${key}" (org ${orgId}):`, err?.message ?? err);
    return errorResponse(`Corrupt config row for "${key}" — repair before continuing`, 500);
  }
}

// PUT /api/config/:key — max 256KB body
const MAX_BODY_BYTES = 256 * 1024;

export async function onRequestPut(context) {
  const key = context.params.key;
  if (!VALID_KEYS.includes(key)) {
    return errorResponse(`Invalid config key: ${key}`, 400);
  }

  // Cap body size to keep config rows from blowing up D1 storage / per-row limits.
  const contentLength = Number(context.request.headers.get("Content-Length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return errorResponse("Config payload too large (max 256KB)", 413);
  }

  const { orgId, isAdmin } = getCtx(context);
  let body;
  try { body = await context.request.json(); } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  // Specs source is admin-only: it picks which repo the /specs-content/
  // proxy reads from. Rather than rejecting non-admin saves that happen
  // to carry a stale `specs` field (which would also reject legitimate
  // edits of *other* settings made while the admin was reconfiguring
  // specs in another tab), we force the persisted value to win: a
  // non-admin's body simply can't change the specs field. Other settings
  // (boardStages, releaseNotesPrompt, slack, etc.) still go through.
  if (key === "settings" && body && typeof body === "object" && !isAdmin) {
    const current = await context.env.DB
      .prepare("SELECT data FROM config WHERE org_id = ? AND key = 'settings'")
      .bind(orgId)
      .first();
    let currentSpecs = undefined;
    if (current?.data) {
      try { currentSpecs = JSON.parse(current.data)?.specs; } catch { /* treat as unset */ }
    }
    if (currentSpecs === undefined) delete body.specs;
    else body.specs = currentSpecs;
  }

  // Validate the specs object before persisting, but ONLY when the admin
  // is actually authoring it on this request — non-admins had body.specs
  // overwritten with the persisted value above, so re-running validation
  // there would 422 legitimate unrelated saves (e.g. specLinks updates
  // from the Specs tab) if a legacy / hand-edited persisted value happens
  // to fail today's checks.
  if (
    key === "settings" &&
    body && typeof body === "object" &&
    body.specs && typeof body.specs === "object" &&
    isAdmin
  ) {
    const s = body.specs;
    if (s.repo !== undefined && s.repo !== "") {
      if (typeof s.repo !== "string" || !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(s.repo.trim())) {
        return errorResponse("Invalid specs.repo (expected 'owner/repo')", 422);
      }
    }
    if (s.rootPath !== undefined && s.rootPath !== "") {
      if (typeof s.rootPath !== "string") {
        return errorResponse("Invalid specs.rootPath", 422);
      }
      const normalized = s.rootPath.trim().replace(/^\/+|\/+$/g, "");
      if (hasUnsafePathSegment(normalized)) {
        return errorResponse("specs.rootPath contains an unsafe segment", 422);
      }
    }
  }

  // Board-stages validation runs before the row write so a malformed config
  // can't get persisted and break the kanban for everyone in the org.
  if (key === "settings" && body && typeof body === "object" && body.boardStages !== undefined) {
    const result = validateBoardStages(body.boardStages);
    if (!result.ok) return errorResponse(result.error, 422);

    // Block the save if any open feature is sitting in a stage that's about
    // to disappear — otherwise it would silently vanish from the board.
    const newIds = new Set(body.boardStages.map((s) => s.id));
    const { results: openFeatures } = await context.env.DB
      .prepare(
        "SELECT number, title, labels_json FROM features WHERE org_id = ? AND state = 'open'",
      )
      .bind(orgId)
      .all();
    const orphans = [];
    for (const row of openFeatures ?? []) {
      const labels = JSON.parse(row.labels_json || "[]");
      const status = extractStatusFromLabels(labels);
      if (!newIds.has(status)) {
        orphans.push({ number: row.number, title: row.title, status });
      }
    }
    if (orphans.length > 0) {
      return jsonResponse(
        {
          error: `Cannot remove stages: ${orphans.length} feature${orphans.length === 1 ? " is" : "s are"} still in a stage being removed`,
          orphans,
        },
        409,
      );
    }
  }

  const serialized = JSON.stringify(body);
  // Measure UTF-8 byte length, not UTF-16 string length — multi-byte chars
  // (emojis, CJK) would otherwise pass a code-unit check and still bust D1.
  const byteLength = new TextEncoder().encode(serialized).byteLength;
  if (byteLength > MAX_BODY_BYTES) {
    return errorResponse("Config payload too large (max 256KB)", 413);
  }

  await context.env.DB
    .prepare(
      `INSERT INTO config (org_id, key, data, updated_at)
       VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
       ON CONFLICT(org_id, key) DO UPDATE SET
         data = excluded.data,
         updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`
    )
    .bind(orgId, key, serialized)
    .run();

  return jsonResponse({ ok: true });
}
