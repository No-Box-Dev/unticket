import { getCtx, jsonResponse } from "../lib/db";
import { syncFeatures } from "../lib/github-sync";

// GET /api/features — return cached features from D1
// Query params: state (default: open)
export async function onRequestGet(context) {
  const { orgId } = getCtx(context);
  const url = new URL(context.request.url);
  const state = url.searchParams.get("state") || "open";

  let query = "SELECT * FROM features WHERE org_id = ?";
  const bindings = [orgId];

  if (state !== "all") {
    query += " AND state = ?";
    bindings.push(state);
  }

  query += " ORDER BY number ASC";

  const rows = await context.env.DB.prepare(query).bind(...bindings).all();

  const data = rows.results.map((row) => ({
    ...row,
    assignees: JSON.parse(row.assignees_json || "[]"),
    labels: JSON.parse(row.labels_json || "[]"),
  }));

  return jsonResponse(data);
}

// POST /api/features/sync — sync features from .gitpulse repo
export async function onRequestPost(context) {
  const { orgId, token, orgLogin } = getCtx(context);
  await syncFeatures(context.env.DB, token, orgId, orgLogin);
  return jsonResponse({ ok: true });
}
