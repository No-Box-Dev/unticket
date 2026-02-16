import { getCtx, jsonResponse } from "../lib/db";

// GET /api/issues — query cached issues
// Query params: state, assignee, repo, since
export async function onRequestGet(context) {
  const { orgId } = getCtx(context);
  const url = new URL(context.request.url);

  const state = url.searchParams.get("state");
  const assignee = url.searchParams.get("assignee");
  const since = url.searchParams.get("since");
  const closedSince = url.searchParams.get("closed_since");
  const repo = url.searchParams.get("repo");

  let query = "SELECT * FROM issues WHERE org_id = ?";
  const bindings = [orgId];

  if (state && state !== "all") {
    query += " AND state = ?";
    bindings.push(state);
  }

  if (assignee) {
    query += " AND EXISTS (SELECT 1 FROM json_each(assignees_json) WHERE json_extract(value, '$.login') = ?)";
    bindings.push(assignee);
  }

  if (closedSince) {
    query += " AND closed_at >= ?";
    bindings.push(closedSince);
  } else if (since) {
    query += " AND updated_at >= ?";
    bindings.push(since);
  }

  if (repo) {
    query += " AND repo = ?";
    bindings.push(repo);
  }

  query += " ORDER BY updated_at DESC";

  const stmt = context.env.DB.prepare(query);
  const rows = await stmt.bind(...bindings).all();

  // Parse JSON fields
  const results = rows.results.map((row) => ({
    ...row,
    assignees: JSON.parse(row.assignees_json || "[]"),
    labels: JSON.parse(row.labels_json || "[]"),
  }));

  return jsonResponse(results);
}
