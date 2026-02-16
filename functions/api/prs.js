import { getCtx, jsonResponse } from "../lib/db";

// GET /api/prs — query cached pull requests
// Query params: state, author, since, repo
export async function onRequestGet(context) {
  const { orgId } = getCtx(context);
  const url = new URL(context.request.url);

  const state = url.searchParams.get("state");
  const author = url.searchParams.get("author");
  const since = url.searchParams.get("since");
  const repo = url.searchParams.get("repo");

  let query = "SELECT * FROM pull_requests WHERE org_id = ?";
  const bindings = [orgId];

  if (state && state !== "all") {
    query += " AND state = ?";
    bindings.push(state);
  }

  if (author) {
    query += " AND author = ?";
    bindings.push(author);
  }

  if (since) {
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
    draft: row.draft === 1,
    requested_reviewers: JSON.parse(row.requested_reviewers_json || "[]"),
    labels: JSON.parse(row.labels_json || "[]"),
  }));

  return jsonResponse(results);
}
