import { getCtx, jsonResponse, errorResponse } from "../lib/db";

// GET /api/events — list events for the current org.
// Query params: type, project_id, actor_id, before (id cursor), limit (default 50, max 200).
export async function onRequestGet(context) {
  const { orgLogin } = getCtx(context);
  if (!orgLogin) return errorResponse("Missing org context", 400);

  const url = new URL(context.request.url);
  const type = url.searchParams.get("type");
  const projectId = url.searchParams.get("project_id");
  const actorId = url.searchParams.get("actor_id");
  const before = url.searchParams.get("before");
  const limit = clampLimit(url.searchParams.get("limit"), 50, 200);

  let sql =
    "SELECT id, delivery_id, source, type, actor_id, project_id, org, repo, summary, payload_json, created_at FROM events WHERE owner_id = ?";
  const binds = [orgLogin];
  if (type) { sql += " AND type = ?"; binds.push(type); }
  if (projectId) { sql += " AND project_id = ?"; binds.push(projectId); }
  if (actorId) { sql += " AND actor_id = ?"; binds.push(actorId); }
  if (before) {
    const n = parseInt(before, 10);
    if (Number.isFinite(n)) { sql += " AND id < ?"; binds.push(n); }
  }
  sql += " ORDER BY id DESC LIMIT ?";
  binds.push(limit);

  const rows = await context.env.DB.prepare(sql).bind(...binds).all();
  return jsonResponse({ events: rows.results ?? [] });
}

function clampLimit(raw, fallback, max) {
  const n = raw ? parseInt(raw, 10) : fallback;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}
