import { getCtx, jsonResponse } from "../lib/db";

// GET /api/members — list cached org members
export async function onRequestGet(context) {
  const { orgId } = getCtx(context);

  const rows = await context.env.DB
    .prepare("SELECT login, avatar_url, kind FROM members WHERE org_id = ? ORDER BY login")
    .bind(orgId)
    .all();

  return jsonResponse(rows.results);
}
