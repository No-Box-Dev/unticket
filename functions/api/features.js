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

// PUT /api/features — upsert a single feature in D1
export async function onRequestPut(context) {
  const { orgId } = getCtx(context);
  const issue = await context.request.json();

  await context.env.DB
    .prepare(
      `INSERT INTO features (org_id, number, title, state, body, assignees_json, labels_json, milestone_title, html_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(org_id, number) DO UPDATE SET
         title = excluded.title,
         state = excluded.state,
         body = excluded.body,
         assignees_json = excluded.assignees_json,
         labels_json = excluded.labels_json,
         milestone_title = excluded.milestone_title,
         html_url = excluded.html_url,
         updated_at = excluded.updated_at`
    )
    .bind(
      orgId,
      issue.number,
      issue.title,
      issue.state ?? "open",
      issue.body ?? "",
      JSON.stringify(issue.assignees ?? []),
      JSON.stringify(issue.labels ?? []),
      issue.milestone_title ?? null,
      issue.html_url ?? null,
      issue.created_at ?? new Date().toISOString(),
      issue.updated_at ?? new Date().toISOString()
    )
    .run();

  return jsonResponse({ ok: true });
}

// DELETE /api/features?number=123 — mark feature as closed in D1
export async function onRequestDelete(context) {
  const { orgId } = getCtx(context);
  const url = new URL(context.request.url);
  const number = url.searchParams.get("number");
  if (!number) return jsonResponse({ error: "number required" }, 400);

  await context.env.DB
    .prepare("UPDATE features SET state = 'closed' WHERE org_id = ? AND number = ?")
    .bind(orgId, parseInt(number))
    .run();

  return jsonResponse({ ok: true });
}

// POST /api/features — sync features from .gitpulse repo
export async function onRequestPost(context) {
  const { orgId, token, orgLogin } = getCtx(context);
  const result = await syncFeatures(context.env.DB, token, orgId, orgLogin);
  return jsonResponse({ ok: true, ...result });
}
