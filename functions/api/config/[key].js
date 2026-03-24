import { getCtx, jsonResponse, errorResponse } from "../../lib/db";

const VALID_KEYS = ["sprint", "features", "people", "settings", "todos", "agentRules", "sprintSnapshots"];

const DEFAULTS = {
  sprint: null,
  features: [],
  people: [],
  settings: null,
  todos: [],
  agentRules: [],
  sprintSnapshots: [],
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
  } catch {
    console.warn(`[gitpulse] Corrupt config data for key "${key}" (org ${orgId}), returning default`);
    return jsonResponse(DEFAULTS[key]);
  }
}

// PUT /api/config/:key
export async function onRequestPut(context) {
  const key = context.params.key;
  if (!VALID_KEYS.includes(key)) {
    return errorResponse(`Invalid config key: ${key}`, 400);
  }

  const { orgId } = getCtx(context);
  let body;
  try { body = await context.request.json(); } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  await context.env.DB
    .prepare(
      `INSERT INTO config (org_id, key, data, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(org_id, key) DO UPDATE SET
         data = excluded.data,
         updated_at = datetime('now')`
    )
    .bind(orgId, key, JSON.stringify(body))
    .run();

  return jsonResponse({ ok: true });
}
