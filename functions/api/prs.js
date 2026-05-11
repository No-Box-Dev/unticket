import { getCtx, jsonResponse } from "../lib/db";
import { getActiveRepoNames } from "../lib/inactive-repos";

// Explicit projection — never SELECT * so adding a column doesn't silently leak it.
const PR_COLUMNS = [
  "id", "repo", "number", "title", "state", "author", "author_avatar",
  "draft", "head_ref", "base_ref", "merged_at",
  "created_at", "updated_at", "html_url",
  "requested_reviewers_json", "labels_json",
].join(", ");

// GET /api/prs — query cached pull requests
// Query params: state, author, since, repo, page, page_size
export async function onRequestGet(context) {
  const { orgId, orgLogin } = getCtx(context);
  const url = new URL(context.request.url);

  // Active repos only — see /api/issues for rationale and Settings exception.
  const activeRepos = await getActiveRepoNames(context.env.DB, orgId, orgLogin);

  const state = url.searchParams.get("state");
  const author = url.searchParams.get("author");
  const since = url.searchParams.get("since");
  const repo = url.searchParams.get("repo");
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(500, Math.max(1, parseInt(url.searchParams.get("page_size") || "100", 10) || 100));

  if (activeRepos.length === 0) {
    return jsonResponse({ data: [], totalCount: 0, page, pageSize });
  }

  // Honor an explicit ?repo= filter only when it's in the active set.
  let repoBindings = activeRepos;
  if (repo) {
    if (!activeRepos.includes(repo)) {
      return jsonResponse({ data: [], totalCount: 0, page, pageSize });
    }
    repoBindings = [repo];
  }

  const repoSql = ` AND repo IN (${repoBindings.map(() => "?").join(",")})`;

  let query = `SELECT ${PR_COLUMNS} FROM pull_requests WHERE org_id = ?${repoSql}`;
  const bindings = [orgId, ...repoBindings];

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

  // Build separate count query from the same WHERE conditions
  let countQuery = `SELECT COUNT(*) as count FROM pull_requests WHERE org_id = ?${repoSql}`;
  const countBindings = [orgId, ...repoBindings];

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

  return jsonResponse({ data: results, totalCount, page, pageSize });
}
