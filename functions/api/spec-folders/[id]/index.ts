import { z } from "zod";
import { getCtx, jsonResponse, errorResponse } from "../../../lib/db";
import { validate } from "../../../lib/validate";

interface Env {
  DB: D1Database;
}

interface Ctx {
  env: Env;
  data: { orgId: number };
  request: Request;
  params: { id: string };
}

interface FolderRow {
  id: number;
  org_id: number;
  name: string;
  description: string | null;
  archived: number;
  archived_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

const UpdateFolderBody = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(500).nullable().optional(),
  })
  .refine(
    (v) => v.name !== undefined || v.description !== undefined,
    { message: "Nothing to update" },
  );

// PATCH /api/spec-folders/:id — rename or re-describe a folder.
export async function onRequestPatch(context: Ctx): Promise<Response> {
  const { orgId } = getCtx(context) as { orgId: number };
  if (!orgId) return errorResponse("Missing org context", 400);

  const id = Number.parseInt(context.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return errorResponse("Invalid folder id", 400);

  let rawBody: unknown;
  try {
    rawBody = await context.request.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }
  const parsed = validate(UpdateFolderBody, rawBody);
  if (!parsed.ok) return parsed.response;
  const patch = parsed.data;

  // Build a dynamic SET clause — one column at a time keeps the SQL tight
  // and avoids the UPDATE-with-COALESCE pattern where a caller can't tell
  // "leave unchanged" from "set to null".
  const sets: string[] = [];
  const binds: (string | null | number)[] = [];
  if (patch.name !== undefined) {
    sets.push("name = ?");
    binds.push(patch.name);
  }
  if (patch.description !== undefined) {
    sets.push("description = ?");
    binds.push(patch.description);
  }
  sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')");

  try {
    const row = await context.env.DB.prepare(
      `UPDATE spec_folders
          SET ${sets.join(", ")}
        WHERE id = ? AND org_id = ?
        RETURNING id, org_id, name, description, archived, archived_at,
                  created_by, created_at, updated_at`,
    )
      .bind(...binds, id, orgId)
      .first<FolderRow>();

    if (!row) return errorResponse(`Unknown folder ${id}`, 404);

    // Include an up-to-date spec_count so the client cache stays consistent.
    const countRow = await context.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM specs
        WHERE org_id = ? AND folder_id = ? AND archived = 0`,
    )
      .bind(orgId, id)
      .first<{ n: number }>();

    return jsonResponse({
      id: row.id,
      name: row.name,
      description: row.description,
      archived: row.archived === 1,
      archivedAt: row.archived_at,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      specCount: countRow?.n ?? 0,
    });
  } catch (err) {
    const msg = (err as Error)?.message ?? "";
    if (/UNIQUE constraint failed/i.test(msg)) {
      return errorResponse(`A project named "${patch.name}" already exists`, 409);
    }
    console.error("[spec-folders] update failed", { msg });
    return errorResponse("Failed to update folder", 500);
  }
}
