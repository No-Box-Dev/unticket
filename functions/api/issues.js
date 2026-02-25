import { getCtx, jsonResponse } from "../lib/db";

// Allowed sort columns (whitelist to prevent SQL injection)
const SORT_COLUMNS = {
  updated_at: "updated_at",
  created_at: "created_at",
  number: "number",
  title: "title",
  repo: "repo",
};

// GET /api/issues — query cached issues with pagination
// Query params: state, assignee, repo, repos, label, since, closed_since,
//               page, page_size, sort, sort_dir, meta
export async function onRequestGet(context) {
  const { orgId } = getCtx(context);
  const url = new URL(context.request.url);

  // Meta endpoint: return distinct labels
  const meta = url.searchParams.get("meta");
  if (meta === "labels") {
    const rows = await context.env.DB.prepare(
      `SELECT DISTINCT json_extract(value, '$.name') AS name,
              json_extract(value, '$.color') AS color
       FROM issues, json_each(labels_json)
       WHERE org_id = ? AND labels_json != '[]'
       ORDER BY name`
    )
      .bind(orgId)
      .all();
    return jsonResponse(rows.results);
  }

  const state = url.searchParams.get("state");
  const assignee = url.searchParams.get("assignee");
  const since = url.searchParams.get("since");
  const closedSince = url.searchParams.get("closed_since");
  const repo = url.searchParams.get("repo");
  const repos = url.searchParams.get("repos"); // comma-separated
  const label = url.searchParams.get("label");
  const sort = url.searchParams.get("sort") || "updated_at";
  const sortDir = url.searchParams.get("sort_dir") === "asc" ? "ASC" : "DESC";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("page_size") || "30", 10)));

  // Validate sort column
  const sortColumn = SORT_COLUMNS[sort] || "updated_at";

  let where = "WHERE org_id = ?";
  const bindings = [orgId];

  if (state && state !== "all") {
    where += " AND state = ?";
    bindings.push(state);
  }

  if (assignee) {
    where += " AND EXISTS (SELECT 1 FROM json_each(assignees_json) WHERE json_extract(value, '$.login') = ?)";
    bindings.push(assignee);
  }

  if (closedSince) {
    where += " AND closed_at >= ?";
    bindings.push(closedSince);
  } else if (since) {
    where += " AND updated_at >= ?";
    bindings.push(since);
  }

  if (repo) {
    where += " AND repo = ?";
    bindings.push(repo);
  }

  if (repos) {
    const repoList = repos.split(",").filter(Boolean);
    if (repoList.length > 0) {
      where += ` AND repo IN (${repoList.map(() => "?").join(",")})`;
      bindings.push(...repoList);
    }
  }

  if (label) {
    where += " AND EXISTS (SELECT 1 FROM json_each(labels_json) WHERE json_extract(value, '$.name') = ?)";
    bindings.push(label);
  }

  const offset = (page - 1) * pageSize;

  // Run count + data queries in parallel
  const countQuery = `SELECT COUNT(*) as total FROM issues ${where}`;
  const dataQuery = `SELECT * FROM issues ${where} ORDER BY ${sortColumn} ${sortDir} LIMIT ? OFFSET ?`;

  const countBindings = [...bindings];
  const dataBindings = [...bindings, pageSize, offset];

  const [countResult, dataResult] = await context.env.DB.batch([
    context.env.DB.prepare(countQuery).bind(...countBindings),
    context.env.DB.prepare(dataQuery).bind(...dataBindings),
  ]);

  const totalCount = countResult.results[0]?.total ?? 0;

  // Parse JSON fields
  const data = dataResult.results.map((row) => ({
    ...row,
    assignees: JSON.parse(row.assignees_json || "[]"),
    labels: JSON.parse(row.labels_json || "[]"),
  }));

  return jsonResponse({ data, totalCount, page, pageSize });
}
