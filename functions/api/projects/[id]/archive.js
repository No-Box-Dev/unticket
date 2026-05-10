import { getCtx, jsonResponse, errorResponse } from "../../../lib/db";

// POST   /api/projects/:id/archive  → archive the project (inactive on platform)
// DELETE /api/projects/:id/archive  → unarchive
//
// Archived projects are excluded from sync and from issue/PR queries.
// The row stays in `projects` (so the user can flip it back on) but
// archived=1 keeps it out of every active scope.

export async function onRequestPost(context) {
  return setArchived(context, 1);
}

export async function onRequestDelete(context) {
  return setArchived(context, 0);
}

async function setArchived(context, value) {
  const { orgLogin } = getCtx(context);
  if (!orgLogin) return errorResponse("Missing org context", 400);
  const { id } = context.params;
  if (!id) return errorResponse("Missing project id", 400);

  const archivedAt = value === 1 ? new Date().toISOString() : null;

  const result = await context.env.DB.prepare(
    `UPDATE projects
        SET archived = ?, archived_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND owner_id = ?`
  ).bind(value, archivedAt, id, orgLogin).run();

  const changes = result.meta?.changes ?? 0;
  if (!changes) return errorResponse(`Unknown project ${id}`, 404);

  return jsonResponse({ ok: true, id, archived: value === 1 });
}
