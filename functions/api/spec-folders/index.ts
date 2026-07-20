import { z } from "zod";
import { getCtx, jsonResponse, errorResponse } from "../../lib/db";
import { validate } from "../../lib/validate";

interface Env {
  DB: D1Database;
}

interface Ctx {
  env: Env;
  data: { orgId: number; userLogin: string };
  request: Request;
}

interface FolderRow {
  id: number;
  org_id: number;
  name: string;
  description: string | null;
  owner: string | null;
  archived: number;
  archived_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  spec_count: number;
}

export interface SpecFolderDto {
  id: number;
  name: string;
  description: string | null;
  owner: string | null;
  archived: boolean;
  archivedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  specCount: number;
}

function toDto(row: FolderRow): SpecFolderDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    owner: row.owner,
    archived: row.archived === 1,
    archivedAt: row.archived_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    specCount: row.spec_count ?? 0,
  };
}

// Owner value is a GitHub login. Same character class as issue assignees
// (functions/api/assign.ts) — GitHub allows `[A-Za-z0-9-]`, no dots or slashes.
const OwnerLogin = z
  .string()
  .trim()
  .min(1)
  .max(39)
  .regex(/^[a-zA-Z0-9-]+$/, "Invalid owner username");

const CreateFolderBody = z.object({
  name: z.string().trim().min(1, "Name is required").max(80, "Name too long (max 80)"),
  description: z.string().trim().max(500, "Description too long (max 500)").optional(),
  owner: OwnerLogin.nullable().optional(),
});

// GET /api/spec-folders?include=all
// Lists folders for the current org. `include=all` returns archived too;
// otherwise only active folders. Response includes `specCount` per folder
// (active specs only in the active view; all specs in `include=all`).
export async function onRequestGet(context: Ctx): Promise<Response> {
  const { orgId } = getCtx(context) as { orgId: number };
  if (!orgId) return errorResponse("Missing org context", 400);

  const url = new URL(context.request.url);
  const includeArchived = url.searchParams.get("include") === "all";

  const archivedFilter = includeArchived ? "" : "AND f.archived = 0";
  const specArchivedJoin = includeArchived ? "" : "AND s.archived = 0";

  const { results } = await context.env.DB.prepare(
    `SELECT f.id, f.org_id, f.name, f.description, f.owner, f.archived, f.archived_at,
            f.created_by, f.created_at, f.updated_at,
            (SELECT COUNT(*) FROM specs s
              WHERE s.org_id = f.org_id AND s.folder_id = f.id ${specArchivedJoin}) AS spec_count
       FROM spec_folders f
      WHERE f.org_id = ? ${archivedFilter}
      ORDER BY f.archived ASC, LOWER(f.name) ASC`,
  )
    .bind(orgId)
    .all<FolderRow>();

  return jsonResponse({ folders: (results ?? []).map(toDto) });
}

// POST /api/spec-folders — create a folder.
// Any authenticated org member can create. Case-insensitive uniqueness across
// active folders is enforced by uq_spec_folders_active_name; a collision
// returns 409 with a clean message.
export async function onRequestPost(context: Ctx): Promise<Response> {
  const { orgId, userLogin } = getCtx(context) as { orgId: number; userLogin: string };
  if (!orgId) return errorResponse("Missing org context", 400);
  if (!userLogin) return errorResponse("Missing user context", 400);

  let rawBody: unknown;
  try {
    rawBody = await context.request.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }
  const parsed = validate(CreateFolderBody, rawBody);
  if (!parsed.ok) return parsed.response;
  const { name, description, owner } = parsed.data;

  try {
    const result = await context.env.DB.prepare(
      `INSERT INTO spec_folders (org_id, name, description, owner, created_by)
       VALUES (?, ?, ?, ?, ?)
       RETURNING id, org_id, name, description, owner, archived, archived_at,
                 created_by, created_at, updated_at`,
    )
      .bind(orgId, name, description ?? null, owner ?? null, userLogin)
      .first<FolderRow>();

    if (!result) return errorResponse("Failed to create folder", 500);
    return jsonResponse(toDto({ ...result, spec_count: 0 }), 201);
  } catch (err) {
    const msg = (err as Error)?.message ?? "";
    if (/UNIQUE constraint failed/i.test(msg)) {
      return errorResponse(`A project named "${name}" already exists`, 409);
    }
    console.error("[spec-folders] create failed", { msg });
    return errorResponse("Failed to create folder", 500);
  }
}
