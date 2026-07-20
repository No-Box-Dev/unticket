import { z } from "zod";
import { getCtx, jsonResponse, errorResponse } from "../../../lib/db";
import { validate } from "../../../lib/validate";
import { sanitizeSpecLinks } from "../../../lib/spec-links";
import { specRowToDto, type SpecRow } from "../../../lib/spec-dto";

interface Env {
  DB: D1Database;
}

interface Ctx {
  env: Env;
  data: { orgId: number };
  request: Request;
  params: { id: string };
}

const SpecLinkSchema = z.object({
  url: z.string(),
  label: z.string().optional(),
});

const UpdateSpecBody = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(20_000).optional(),
    // null explicitly moves the spec to Unfiled; undefined leaves it alone.
    folderId: z.number().int().positive().nullable().optional(),
    links: z.array(SpecLinkSchema).max(50).optional(),
  })
  .refine(
    (v) =>
      v.title !== undefined ||
      v.description !== undefined ||
      v.folderId !== undefined ||
      v.links !== undefined,
    { message: "Nothing to update" },
  );

// GET /api/specs/:id — fetch a single spec (used by the detail-modal deep link).
export async function onRequestGet(context: Ctx): Promise<Response> {
  const { orgId } = getCtx(context) as { orgId: number };
  if (!orgId) return errorResponse("Missing org context", 400);

  const id = Number.parseInt(context.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return errorResponse("Invalid spec id", 400);

  const row = await context.env.DB.prepare(
    `SELECT id, org_id, folder_id, title, description, links_json,
            archived, archived_at, created_by, created_at, updated_at
       FROM specs
      WHERE id = ? AND org_id = ?`,
  )
    .bind(id, orgId)
    .first<SpecRow>();

  if (!row) return errorResponse(`Unknown spec ${id}`, 404);
  return jsonResponse(specRowToDto(row));
}

// PATCH /api/specs/:id — partial update. `folderId: null` moves to Unfiled;
// omit `folderId` to leave it unchanged.
export async function onRequestPatch(context: Ctx): Promise<Response> {
  const { orgId } = getCtx(context) as { orgId: number };
  if (!orgId) return errorResponse("Missing org context", 400);

  const id = Number.parseInt(context.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return errorResponse("Invalid spec id", 400);

  let rawBody: unknown;
  try {
    rawBody = await context.request.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }
  const parsed = validate(UpdateSpecBody, rawBody);
  if (!parsed.ok) return parsed.response;
  const patch = parsed.data;

  // Verify folder ownership before writing so a bad id doesn't leave a
  // half-applied update (D1 batches don't roll back on constraint errors).
  if (patch.folderId != null) {
    const folder = await context.env.DB.prepare(
      "SELECT id FROM spec_folders WHERE id = ? AND org_id = ? AND archived = 0",
    )
      .bind(patch.folderId, orgId)
      .first<{ id: number }>();
    if (!folder) return errorResponse(`Unknown or archived folder ${patch.folderId}`, 400);
  }

  const sets: string[] = [];
  const binds: (string | number | null)[] = [];
  if (patch.title !== undefined) {
    sets.push("title = ?");
    binds.push(patch.title);
  }
  if (patch.description !== undefined) {
    sets.push("description = ?");
    binds.push(patch.description);
  }
  if (patch.folderId !== undefined) {
    sets.push("folder_id = ?");
    binds.push(patch.folderId);
  }
  if (patch.links !== undefined) {
    sets.push("links_json = ?");
    binds.push(JSON.stringify(sanitizeSpecLinks(patch.links)));
  }
  sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')");

  const row = await context.env.DB.prepare(
    `UPDATE specs
        SET ${sets.join(", ")}
      WHERE id = ? AND org_id = ?
      RETURNING id, org_id, folder_id, title, description, links_json,
                archived, archived_at, created_by, created_at, updated_at`,
  )
    .bind(...binds, id, orgId)
    .first<SpecRow>();

  if (!row) return errorResponse(`Unknown spec ${id}`, 404);
  return jsonResponse(specRowToDto(row));
}
