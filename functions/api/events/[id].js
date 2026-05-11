import { getCtx, jsonResponse, errorResponse } from "../../lib/db";

// GET /api/events/:id — single event scoped to the current org.
// Used by the Posts tab to lazy-load PR body + url when a card is expanded.
export async function onRequestGet(context) {
  const { orgLogin } = getCtx(context);
  const { id } = context.params;
  if (!orgLogin) return errorResponse("Missing org context", 400);
  if (!id) return errorResponse("Missing id", 400);

  const numericId = parseInt(id, 10);
  if (!Number.isFinite(numericId)) return errorResponse("Invalid id", 400);

  const row = await context.env.DB.prepare(
    `SELECT id, delivery_id, source, type, actor_id, project_id, org, repo, summary, payload_json, created_at
     FROM events
     WHERE id = ? AND owner_id = ?`
  ).bind(numericId, orgLogin).first();

  if (!row) return errorResponse("Unknown event", 404);
  return jsonResponse({ event: row });
}
