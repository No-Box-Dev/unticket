import { getCtx, jsonResponse, errorResponse } from "../lib/db";

// GET /api/events — list events for the current org.
// Query params: type, project_id, actor_id, before (composite cursor
// "<created_at>:<id>"), limit (default 50, max 200).
export async function onRequestGet(context) {
  const { orgLogin } = getCtx(context);
  if (!orgLogin) return errorResponse("Missing org context", 400);

  const url = new URL(context.request.url);
  const type = url.searchParams.get("type");
  const projectId = url.searchParams.get("project_id");
  const actorId = url.searchParams.get("actor_id");
  const before = url.searchParams.get("before");
  const limit = clampLimit(url.searchParams.get("limit"), 50, 200);
  // Comma-separated allowlist of raw event types that a narrative was
  // produced from. Used by the Posts feed to show only "shipped" events
  // (PR merged, issue closed) without burning DB rows on opens/reviews.
  const triggerTypes = (url.searchParams.get("trigger_types") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  let sql =
    "SELECT id, delivery_id, source, type, actor_id, project_id, org, repo, summary, payload_json, created_at FROM events WHERE owner_id = ?";
  const binds = [orgLogin];
  if (type) { sql += " AND type = ?"; binds.push(type); }
  if (projectId) { sql += " AND project_id = ?"; binds.push(projectId); }
  if (actorId) { sql += " AND actor_id = ?"; binds.push(actorId); }
  if (triggerTypes.length > 0) {
    const placeholders = triggerTypes.map(() => "?").join(",");
    sql += ` AND json_extract(payload_json, '$.trigger_type') IN (${placeholders})`;
    binds.push(...triggerTypes);
  }
  // Cursor must match the ORDER BY (created_at DESC, id DESC) — a bare id
  // comparison drops events that share a created_at second with the cursor.
  // Format: "<created_at>:<id>"; legacy numeric values fall back to id-only.
  if (before) {
    const cursor = parseCursor(before);
    if (cursor) {
      sql += " AND (created_at < ? OR (created_at = ? AND id < ?))";
      binds.push(cursor.createdAt, cursor.createdAt, cursor.id);
    } else if (Number.isFinite(parseInt(before, 10))) {
      sql += " AND id < ?";
      binds.push(parseInt(before, 10));
    }
  }
  // Order by event time, not insertion order — a narrative for an old PR
  // backfilled just now should sort *below* a fresh merge from this morning.
  // id is the tiebreaker for narratives sharing a created_at second.
  sql += " ORDER BY created_at DESC, id DESC LIMIT ?";
  binds.push(limit);

  const rows = await context.env.DB.prepare(sql).bind(...binds).all();
  const events = rows.results ?? [];
  const last = events[events.length - 1];
  const nextCursor = last ? `${last.created_at}:${last.id}` : null;
  return jsonResponse({ events, nextCursor });
}

function parseCursor(value) {
  const idx = value.lastIndexOf(":");
  if (idx <= 0) return null;
  const createdAt = value.slice(0, idx);
  const id = parseInt(value.slice(idx + 1), 10);
  if (!Number.isFinite(id) || !createdAt) return null;
  return { createdAt, id };
}

function clampLimit(raw, fallback, max) {
  const n = raw ? parseInt(raw, 10) : fallback;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}
