import { getCtx, jsonResponse, errorResponse } from "../lib/db";

// GET /api/notes?actor_id=&project_id= — list per-(actor, project) tone nudges.
export async function onRequestGet(context) {
  const { orgLogin } = getCtx(context);
  if (!orgLogin) return errorResponse("Missing org context", 400);

  const url = new URL(context.request.url);
  const actorId = url.searchParams.get("actor_id");
  const projectId = url.searchParams.get("project_id");

  let sql =
    `SELECT n.actor_id, n.project_id, n.note, n.updated_at
       FROM actor_repo_notes n
       JOIN actors a ON a.id = n.actor_id
      WHERE a.owner_id = ?`;
  const binds = [orgLogin];
  if (actorId) { sql += " AND n.actor_id = ?"; binds.push(actorId); }
  if (projectId) { sql += " AND n.project_id = ?"; binds.push(projectId); }

  const rows = await context.env.DB.prepare(sql).bind(...binds).all();
  return jsonResponse({ notes: rows.results ?? [] });
}

// PUT /api/notes  body: { actor_id, project_id, note }
// Empty note deletes the row.
export async function onRequestPut(context) {
  const { orgLogin } = getCtx(context);
  if (!orgLogin) return errorResponse("Missing org context", 400);

  let body;
  try {
    body = await context.request.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }
  if (!body.actor_id || !body.project_id) {
    return errorResponse("actor_id and project_id are required", 400);
  }

  const db = context.env.DB;

  const actor = await db.prepare(
    "SELECT 1 FROM actors WHERE id = ? AND owner_id = ?"
  ).bind(body.actor_id, orgLogin).first();
  if (!actor) return errorResponse(`Unknown actor ${body.actor_id}`, 404);

  const project = await db.prepare(
    "SELECT 1 FROM projects WHERE id = ? AND owner_id = ?"
  ).bind(body.project_id, orgLogin).first();
  if (!project) return errorResponse(`Unknown project ${body.project_id}`, 404);

  const note = (body.note ?? "").trim();
  if (!note) {
    await db.prepare(
      "DELETE FROM actor_repo_notes WHERE actor_id = ? AND project_id = ?"
    ).bind(body.actor_id, body.project_id).run();
    return jsonResponse({ ok: true, deleted: true });
  }

  await db.prepare(
    `INSERT INTO actor_repo_notes (actor_id, project_id, note, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(actor_id, project_id) DO UPDATE SET
       note = excluded.note,
       updated_at = excluded.updated_at`
  ).bind(body.actor_id, body.project_id, note).run();

  return jsonResponse({ ok: true, actor_id: body.actor_id, project_id: body.project_id, note });
}

// DELETE /api/notes?actor_id=&project_id=
export async function onRequestDelete(context) {
  const { orgLogin } = getCtx(context);
  if (!orgLogin) return errorResponse("Missing org context", 400);

  const url = new URL(context.request.url);
  const actorId = url.searchParams.get("actor_id");
  const projectId = url.searchParams.get("project_id");
  if (!actorId || !projectId) return errorResponse("actor_id and project_id query params required", 400);

  const db = context.env.DB;

  const actor = await db.prepare(
    "SELECT 1 FROM actors WHERE id = ? AND owner_id = ?"
  ).bind(actorId, orgLogin).first();
  if (!actor) return errorResponse(`Unknown actor ${actorId}`, 404);

  await db.prepare(
    "DELETE FROM actor_repo_notes WHERE actor_id = ? AND project_id = ?"
  ).bind(actorId, projectId).run();
  return jsonResponse({ ok: true });
}
