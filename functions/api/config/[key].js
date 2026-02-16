import { getCtx, jsonResponse, errorResponse } from "../../lib/db";

const VALID_KEYS = ["sprint", "features", "people", "settings"];

// GET /api/config/:key — read config
export async function onRequestGet(context) {
  const key = context.params.key;
  if (!VALID_KEYS.includes(key)) {
    return errorResponse(`Invalid config key: ${key}`, 400);
  }

  const { orgId } = getCtx(context);

  const row = await context.env.DB
    .prepare("SELECT data, updated_at FROM config WHERE org_id = ? AND key = ?")
    .bind(orgId, key)
    .first();

  if (!row) {
    // Return sensible defaults
    const defaults = {
      sprint: null,
      features: [],
      people: [],
      settings: { teams: [{ name: "Team", color: "#1B6971", repos: [] }] },
    };
    return jsonResponse(defaults[key]);
  }

  return jsonResponse(JSON.parse(row.data));
}

// PUT /api/config/:key — write config
export async function onRequestPut(context) {
  const key = context.params.key;
  if (!VALID_KEYS.includes(key)) {
    return errorResponse(`Invalid config key: ${key}`, 400);
  }

  const { orgId } = getCtx(context);
  const body = await context.request.json();
  const data = JSON.stringify(body);

  await context.env.DB
    .prepare(
      `INSERT INTO config (org_id, key, data, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(org_id, key) DO UPDATE SET
         data = excluded.data,
         updated_at = datetime('now')`
    )
    .bind(orgId, key, data)
    .run();

  return jsonResponse({ ok: true });
}
