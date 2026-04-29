import { getCtx, jsonResponse } from "../lib/db";

// Allowed sort columns (whitelist to prevent SQL injection)
const SORT_COLUMNS = {
  updated_at: "updated_at",
  created_at: "created_at",
  number: "number",
  title: "title",
  repo: "repo",
};

// Explicit projection — never SELECT * so adding a column doesn't silently leak it.
const ISSUE_COLUMNS = [
  "id", "repo", "number", "title", "state", "author", "author_avatar",
  "created_at", "updated_at", "closed_at", "html_url",
  "assignees_json", "labels_json", "milestone_title", "closed_by",
].join(", ");

// GET /api/issues — query cached issues with pagination
// Query params: state, assignee, repo, repos, label, since, closed_since,
//               page, page_size, sort, sort_dir, meta
export async function onRequestGet(context) {
  try {
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

  if (meta === "stats") {
    const closedSince = url.searchParams.get("closed_since") || null;
    const reposParam = url.searchParams.get("repos") || null;

    let repoFilter = "";
    const repoBindings = [];
    if (reposParam) {
      const repoList = reposParam.split(",").filter(Boolean).slice(0, 95);
      if (repoList.length > 0) {
        repoFilter = ` AND repo IN (${repoList.map(() => "?").join(",")})`;
        repoBindings.push(...repoList);
      }
    }

    const staleDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const queries = [
      // open count
      context.env.DB.prepare(`SELECT COUNT(*) as c FROM issues WHERE org_id = ? AND state = 'open'${repoFilter}`).bind(orgId, ...repoBindings),
      // unassigned open count
      context.env.DB.prepare(`SELECT COUNT(*) as c FROM issues WHERE org_id = ? AND state = 'open' AND (assignees_json = '[]' OR assignees_json IS NULL)${repoFilter}`).bind(orgId, ...repoBindings),
      // stale open count (created > 30d ago)
      context.env.DB.prepare(`SELECT COUNT(*) as c FROM issues WHERE org_id = ? AND state = 'open' AND created_at < ?${repoFilter}`).bind(orgId, staleDate, ...repoBindings),
      // closed since sprint start
      context.env.DB.prepare(`SELECT COUNT(*) as c FROM issues WHERE org_id = ? AND state = 'closed'${closedSince ? " AND closed_at >= ?" : ""}${repoFilter}`).bind(orgId, ...(closedSince ? [closedSince] : []), ...repoBindings),
      // by repo (open)
      context.env.DB.prepare(`SELECT repo, COUNT(*) as count FROM issues WHERE org_id = ? AND state = 'open'${repoFilter} GROUP BY repo ORDER BY count DESC LIMIT 15`).bind(orgId, ...repoBindings),
      // by label (open)
      context.env.DB.prepare(`SELECT json_extract(value, '$.name') AS name, json_extract(value, '$.color') AS color, COUNT(*) as count FROM issues, json_each(labels_json) WHERE org_id = ? AND state = 'open' AND labels_json != '[]'${repoFilter} GROUP BY name ORDER BY count DESC LIMIT 10`).bind(orgId, ...repoBindings),
      // closed per day (last 28 days)
      context.env.DB.prepare(`SELECT date(closed_at) as day, COUNT(*) as count FROM issues WHERE org_id = ? AND state = 'closed' AND closed_at >= date('now', '-28 days')${repoFilter} GROUP BY day ORDER BY day`).bind(orgId, ...repoBindings),
      // critical open by repo
      context.env.DB.prepare(`SELECT repo, COUNT(*) as count FROM issues WHERE org_id = ? AND state = 'open' AND EXISTS (SELECT 1 FROM json_each(labels_json) WHERE json_extract(value, '$.name') = 'critical')${repoFilter} GROUP BY repo`).bind(orgId, ...repoBindings),
      // critical closed per day (last 28 days)
      context.env.DB.prepare(`SELECT date(closed_at) as day, COUNT(*) as count FROM issues WHERE org_id = ? AND state = 'closed' AND closed_at >= date('now', '-28 days') AND EXISTS (SELECT 1 FROM json_each(labels_json) WHERE json_extract(value, '$.name') = 'critical')${repoFilter} GROUP BY day ORDER BY day`).bind(orgId, ...repoBindings),
    ];

    const results = await context.env.DB.batch(queries);

    // Build critical-by-repo lookup
    const criticalByRepo = Object.fromEntries((results[7].results ?? []).map((r) => [r.repo, r.count]));
    // Build critical-closed-per-day lookup
    const criticalClosedMap = Object.fromEntries((results[8].results ?? []).map((r) => [r.day, r.count]));

    return jsonResponse({
      open: results[0].results[0]?.c ?? 0,
      unassigned: results[1].results[0]?.c ?? 0,
      stale: results[2].results[0]?.c ?? 0,
      closedSprint: results[3].results[0]?.c ?? 0,
      byRepo: results[4].results.map((r) => ({ ...r, critical: criticalByRepo[r.repo] ?? 0 })),
      byLabel: results[5].results,
      closedPerDay: results[6].results.map((r) => ({ ...r, critical: criticalClosedMap[r.day] ?? 0 })),
    });
  }

  const state = url.searchParams.get("state");
  const assignee = url.searchParams.get("assignee");
  const assigned = url.searchParams.get("assigned"); // "true" | "false" | null
  const since = url.searchParams.get("since");
  const closedSince = url.searchParams.get("closed_since");
  const closedBefore = url.searchParams.get("closed_before");
  const repo = url.searchParams.get("repo");
  const repos = url.searchParams.get("repos"); // comma-separated
  const label = url.searchParams.get("label");
  const sort = url.searchParams.get("sort") || "updated_at";
  const sortDir = url.searchParams.get("sort_dir") === "asc" ? "ASC" : "DESC";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(5000, Math.max(1, parseInt(url.searchParams.get("page_size") || "30", 10)));

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
  } else if (assigned === "false") {
    where += " AND (assignees_json = '[]' OR assignees_json IS NULL)";
  } else if (assigned === "true") {
    where += " AND assignees_json != '[]' AND assignees_json IS NOT NULL";
  }

  if (closedSince) {
    where += " AND closed_at >= ?";
    bindings.push(closedSince);
  }
  if (closedBefore) {
    where += " AND closed_at < ?";
    bindings.push(closedBefore);
  }
  if (!closedSince && !closedBefore && since) {
    where += " AND updated_at >= ?";
    bindings.push(since);
  }

  if (repo) {
    where += " AND repo = ?";
    bindings.push(repo);
  }

  if (repos) {
    const repoList = repos.split(",").filter(Boolean).slice(0, 90); // Cap to stay within D1 bind limits (100 max per stmt)
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
  const dataQuery = `SELECT ${ISSUE_COLUMNS} FROM issues ${where} ORDER BY ${sortColumn} ${sortDir} LIMIT ? OFFSET ?`;

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
    closed_by: row.closed_by ?? null,
  }));

  return jsonResponse({ data, totalCount, page, pageSize });
  } catch (err) {
    console.error("[issues] Error:", err?.message ?? err);
    return new Response(JSON.stringify({ error: "Internal server error", detail: err?.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
