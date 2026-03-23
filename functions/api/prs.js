import { getCtx, jsonResponse } from "../lib/db";

// GET /api/prs — query cached pull requests
// Query params: state, author, since, repo, page, page_size
export async function onRequestGet(context) {
  const { orgId } = getCtx(context);
  const url = new URL(context.request.url);

  const state = url.searchParams.get("state");
  const author = url.searchParams.get("author");
  const since = url.searchParams.get("since");
  const repo = url.searchParams.get("repo");
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(5000, Math.max(1, parseInt(url.searchParams.get("page_size") || "5000", 10) || 5000));

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

  // Build separate count query from the same WHERE conditions
  let countQuery = "SELECT COUNT(*) as count FROM pull_requests WHERE org_id = ?";
  const countBindings = [orgId];

  if (state && state !== "all") {
    countQuery += " AND state = ?";
    countBindings.push(state);
  }
  if (author) {
    countQuery += " AND author = ?";
    countBindings.push(author);
  }
  if (since) {
    countQuery += " AND updated_at >= ?";
    countBindings.push(since);
  }
  if (repo) {
    countQuery += " AND repo = ?";
    countBindings.push(repo);
  }

  const countStmt = context.env.DB.prepare(countQuery).bind(...countBindings);

  query += " ORDER BY updated_at DESC LIMIT ? OFFSET ?";
  const dataStmt = context.env.DB.prepare(query).bind(...bindings, pageSize, (page - 1) * pageSize);

  const [countResult, rows] = await context.env.DB.batch([countStmt, dataStmt]);
  const totalCount = countResult?.results?.[0]?.count ?? 0;

  // Parse JSON fields
  const results = rows.results.map((row) => ({
    ...row,
    draft: row.draft === 1,
    requested_reviewers: JSON.parse(row.requested_reviewers_json || "[]"),
    labels: JSON.parse(row.labels_json || "[]"),
  }));

  return jsonResponse(results);
}
