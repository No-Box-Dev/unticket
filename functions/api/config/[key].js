import { getCtx, jsonResponse, errorResponse } from "../../lib/db";

const VALID_KEYS = ["features", "people", "settings", "agentRules"];

const DEFAULTS = {
  features: [],
  people: [],
  settings: null,
  agentRules: [],
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

  const { orgId } = getCtx(context);
  let body;
  try { body = await context.request.json(); } catch {
    return errorResponse("Invalid JSON body", 400);
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
