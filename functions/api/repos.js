import { getCtx, jsonResponse } from "../lib/db";

// GET /api/repos — list cached repos
export async function onRequestGet(context) {
  const { orgId } = getCtx(context);

  const rows = await context.env.DB
    .prepare("SELECT name, language, pushed_at FROM repos WHERE org_id = ? ORDER BY pushed_at DESC")
    .bind(orgId)
    .all();

  return jsonResponse(rows.results);
}
