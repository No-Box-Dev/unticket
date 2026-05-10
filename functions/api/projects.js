import { getCtx, jsonResponse, errorResponse } from "../lib/db";

// GET /api/projects — list projects (narrator scope) for this org.
// Auto-registered by the webhook (proj_<org>_<repo>) on first event.
export async function onRequestGet(context) {
  const { orgLogin } = getCtx(context);
  if (!orgLogin) return errorResponse("Missing org context", 400);

  const rows = await context.env.DB.prepare(
    `SELECT id, name, slug, org, repo, description, narrator_enabled, updated_at
       FROM projects
      WHERE owner_id = ?
      ORDER BY name`
  ).bind(orgLogin).all();

  return jsonResponse({ projects: rows.results ?? [] });
}
