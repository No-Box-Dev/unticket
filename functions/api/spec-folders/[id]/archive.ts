import { getCtx, jsonResponse, errorResponse } from "../../../lib/db";

interface Env {
  DB: D1Database;
}

interface Ctx {
  env: Env;
  data: { orgId: number; isAdmin: boolean };
  request: Request;
  params: { id: string };
}

// POST   /api/spec-folders/:id/archive  → archive folder + cascade-archive
//                                         all its currently-active specs.
// DELETE /api/spec-folders/:id/archive  → unarchive folder only. Specs stay
//                                         archived — admins restore them
//                                         individually. Documented asymmetry.
//
// Admin-gated. Response includes `cascadedSpecIds` on POST so the client
// cache can patch archived=true on those specs without a round-trip refetch.

export async function onRequestPost(context: Ctx): Promise<Response> {
  return setArchived(context, true);
}

export async function onRequestDelete(context: Ctx): Promise<Response> {
  return setArchived(context, false);
}

async function setArchived(context: Ctx, archive: boolean): Promise<Response> {
  const { orgId, isAdmin } = getCtx(context) as { orgId: number; isAdmin: boolean };
  if (!orgId) return errorResponse("Missing org context", 400);
  if (!isAdmin) return errorResponse("Admin required", 403);

  const id = Number.parseInt(context.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return errorResponse("Invalid folder id", 400);

  const nowIso = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const archivedAt = archive ? nowIso : null;

  if (archive) {
    // Collect the spec ids we're about to cascade so the client can update
    // its cache. Query BEFORE the update so we only get currently-active
    // specs (avoids double-counting anything already archived).
    const { results } = await context.env.DB.prepare(
      `SELECT id FROM specs
        WHERE org_id = ? AND folder_id = ? AND archived = 0`,
    )
      .bind(orgId, id)
      .all<{ id: number }>();
    const cascadedSpecIds = (results ?? []).map((r) => r.id);

    const [folderRes] = await context.env.DB.batch([
      context.env.DB.prepare(
        `UPDATE spec_folders
            SET archived = 1, archived_at = ?,
                updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
          WHERE id = ? AND org_id = ? AND archived = 0`,
      ).bind(archivedAt, id, orgId),
      context.env.DB.prepare(
        `UPDATE specs
            SET archived = 1, archived_at = ?,
                updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
          WHERE org_id = ? AND folder_id = ? AND archived = 0`,
      ).bind(archivedAt, orgId, id),
    ]);

    const changes = folderRes.meta?.changes ?? 0;
    if (!changes) return errorResponse(`Unknown folder ${id} (or already archived)`, 404);

    return jsonResponse({ ok: true, id, archived: true, cascadedSpecIds });
  }

  const res = await context.env.DB.prepare(
    `UPDATE spec_folders
        SET archived = 0, archived_at = NULL,
            updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
      WHERE id = ? AND org_id = ? AND archived = 1`,
  )
    .bind(id, orgId)
    .run();

  const changes = res.meta?.changes ?? 0;
  if (!changes) return errorResponse(`Unknown folder ${id} (or not archived)`, 404);

  return jsonResponse({ ok: true, id, archived: false });
}
