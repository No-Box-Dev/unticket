import { z } from "zod";
import { getCtx, jsonResponse, errorResponse } from "../../lib/db";
import { validate } from "../../lib/validate";
import { sanitizeSpecLinks } from "../../lib/spec-links";
import { specRowToDto, type SpecRow } from "../../lib/spec-dto";

interface Env {
  DB: D1Database;
}

interface Ctx {
  env: Env;
  data: { orgId: number; userLogin: string };
  request: Request;
}

const SpecLinkSchema = z.object({
  url: z.string(),
  label: z.string().optional(),
});

const CreateSpecBody = z.object({
  title: z.string().trim().min(1, "Title is required").max(200, "Title too long (max 200)"),
  description: z.string().max(20_000, "Description too long (max 20000)").optional(),
  folderId: z.number().int().positive().nullable().optional(),
  links: z.array(SpecLinkSchema).max(50).optional(),
});

// GET /api/specs?folderId=<n|unfiled>&include=all
// Lists specs for the current org. Filters:
//   folderId=<n>       — specs in that folder (must belong to this org)
//   folderId=unfiled   — specs with folder_id IS NULL
//   (omitted)          — all folders
//   include=all        — include archived specs (default hides them)
export async function onRequestGet(context: Ctx): Promise<Response> {
  const { orgId } = getCtx(context) as { orgId: number };
  if (!orgId) return errorResponse("Missing org context", 400);

  const url = new URL(context.request.url);
  const includeArchived = url.searchParams.get("include") === "all";
  const folderIdParam = url.searchParams.get("folderId");

  const clauses: string[] = ["org_id = ?"];
  const binds: (string | number)[] = [orgId];

  if (folderIdParam === "unfiled") {
    clauses.push("folder_id IS NULL");
  } else if (folderIdParam !== null && folderIdParam !== "") {
    const folderId = Number.parseInt(folderIdParam, 10);
    if (!Number.isFinite(folderId) || folderId <= 0) {
      return errorResponse("Invalid folderId", 400);
    }
    clauses.push("folder_id = ?");
    binds.push(folderId);
  }

  if (!includeArchived) clauses.push("archived = 0");

  const { results } = await context.env.DB.prepare(
    `SELECT id, org_id, folder_id, title, description, links_json,
            archived, archived_at, created_by, created_at, updated_at
       FROM specs
      WHERE ${clauses.join(" AND ")}
      ORDER BY archived ASC, updated_at DESC`,
  )
    .bind(...binds)
    .all<SpecRow>();

  return jsonResponse({ specs: (results ?? []).map(specRowToDto) });
}

// POST /api/specs — create a spec. Server sanitizes links (http/https only,
// cap 50, label ≤ 200 chars) before storage.
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
  const parsed = validate(CreateSpecBody, rawBody);
  if (!parsed.ok) return parsed.response;
  const { title, description, folderId, links } = parsed.data;

  // Verify the target folder (if any) belongs to this org and isn't archived.
  // Cheap safeguard against a client accidentally posting a foreign folder id.
  if (folderId != null) {
    const folder = await context.env.DB.prepare(
      "SELECT id FROM spec_folders WHERE id = ? AND org_id = ? AND archived = 0",
    )
      .bind(folderId, orgId)
      .first<{ id: number }>();
    if (!folder) return errorResponse(`Unknown or archived folder ${folderId}`, 400);
  }

  const cleanLinks = sanitizeSpecLinks(links ?? []);
  const linksJson = JSON.stringify(cleanLinks);

  const row = await context.env.DB.prepare(
    `INSERT INTO specs (org_id, folder_id, title, description, links_json, created_by)
     VALUES (?, ?, ?, ?, ?, ?)
     RETURNING id, org_id, folder_id, title, description, links_json,
               archived, archived_at, created_by, created_at, updated_at`,
  )
    .bind(orgId, folderId ?? null, title, description ?? "", linksJson, userLogin)
    .first<SpecRow>();

  if (!row) return errorResponse("Failed to create spec", 500);
  return jsonResponse(specRowToDto(row), 201);
}
