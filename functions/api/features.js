// /api/features — server-side proxy for the kanban board.
//
// GET: read features from D1 (the cached projection populated by webhooks +
// these very endpoints).
// POST: create a feature issue on GitHub, mirror the response to D1.
//
// PATCH and DELETE for a single feature live in features/[number].js.
// PUT used to exist as the dumb "syncIssueToD1" sink for the old
// browser-side Octokit path; it's gone now because every server endpoint
// mirrors its own response.

import { getCtx, jsonResponse, errorResponse } from "../lib/db";
import { getInstallationIdForOrg, getInstallationToken } from "../lib/github-app";
import { resolveBoardStages } from "../lib/board-stages.js";
import {
  buildFeatureLabels,
  buildIssueBody,
  createFeatureIssue,
  ensureUnticketRepoLabels,
  ghIssueToFeature,
  readLinkedPRs,
  upsertFeatureRow,
} from "../lib/feature-issues";

// Explicit projection — never SELECT * so adding a column doesn't silently leak it.
const FEATURE_COLUMNS = [
  "id", "number", "title", "state", "body",
  "assignees_json", "labels_json", "milestone_title",
  "html_url", "created_at", "updated_at",
].join(", ");

// Hydrates `linkedPRs` from the `pr_feature_links` table (not the body
// metadata) because the LLM matcher writes to the table only and never
// touches the issue body. The table is the union of manual + deterministic
// + LLM matches; the body metadata only covers manual + deterministic.
export async function onRequestGet(context) {
  const { orgId } = getCtx(context);
  const url = new URL(context.request.url);
  const state = url.searchParams.get("state") || "open";

  const [featureRows, linkRows] = await context.env.DB.batch([
    context.env.DB
      .prepare(
        `SELECT ${FEATURE_COLUMNS} FROM features WHERE org_id = ? AND state = ? ORDER BY number ASC`,
      )
      .bind(orgId, state),
    context.env.DB
      .prepare(
        "SELECT feature_number, pr_repo, pr_number FROM pr_feature_links WHERE org_id = ?",
      )
      .bind(orgId),
  ]);

  const linksByFeature = new Map();
  for (const link of linkRows.results ?? []) {
    let arr = linksByFeature.get(link.feature_number);
    if (!arr) {
      arr = [];
      linksByFeature.set(link.feature_number, arr);
    }
    arr.push({ repo: link.pr_repo, number: link.pr_number });
  }

  const data = featureRows.results.map((row) => ({
    ...row,
    assignees: JSON.parse(row.assignees_json || "[]"),
    labels: JSON.parse(row.labels_json || "[]"),
    linkedPRs: linksByFeature.get(row.number) ?? [],
  }));

  return jsonResponse(data);
}

// POST /api/features — create a feature on GitHub, mirror to D1.
// Body: { title, status, owners?: string[], plan?: string }
//
// Uses the GitHub App installation token (NOT the caller's OAuth token), so
// any logged-in user can create features regardless of their personal repo
// permissions on {org}/unticket. The webhook + cron syncFeatures + Settings
// "Full Re-sync" already cover the inbound path for issues users create
// directly on GitHub, so D1 stays correct either way.
//
// Stays synchronous because we need GitHub's assigned issue number before we
// can write a D1 row — PATCH and DELETE are the optimistic ones.
export async function onRequestPost(context) {
  const { orgId, orgLogin } = getCtx(context);
  if (!orgLogin) return errorResponse("Missing org context", 400);

  let payload;
  try { payload = await context.request.json(); } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const title = typeof payload?.title === "string" ? payload.title.trim() : "";
  if (!title) return errorResponse("title is required", 422);

  const stages = await resolveBoardStages(context.env.DB, orgId);
  const validStatusIds = new Set(stages.map((s) => s.id));
  const status = payload?.status ?? stages[0]?.id ?? "todo";
  if (!validStatusIds.has(status)) return errorResponse(`Invalid status: ${status}`, 422);

  const owners = Array.isArray(payload?.owners)
    ? payload.owners.filter((o) => typeof o === "string" && /^[a-zA-Z0-9-]+$/.test(o))
    : [];
  const plan = typeof payload?.plan === "string" ? payload.plan : "";

  const installationId = await getInstallationIdForOrg(context.env.DB, orgId);
  if (!installationId) return errorResponse("GitHub App not installed for this org", 412);

  let token;
  try {
    token = await getInstallationToken(context.env, installationId);
  } catch (err) {
    console.error("[features:post] install token fetch failed", { msg: err?.message });
    return errorResponse("Failed to acquire GitHub App token", 500);
  }

  try {
    await ensureUnticketRepoLabels(token, orgLogin, stages);

    const body = buildIssueBody(plan, {
      statusHistory: [{ status, timestamp: new Date().toISOString() }],
    });

    const ghIssue = await createFeatureIssue(token, orgLogin, {
      title,
      body,
      labels: buildFeatureLabels(status),
      ...(owners.length > 0 ? { assignees: owners } : {}),
    });

    await upsertFeatureRow(context.env.DB, orgId, ghIssue, { from: "github" });
    const linkedPRs = await readLinkedPRs(context.env.DB, orgId, ghIssue.number);
    return jsonResponse(ghIssueToFeature(ghIssue, linkedPRs), 201);
  } catch (err) {
    console.error("[features:post] GitHub create failed", { status: err?.status, msg: err?.message, ghBody: err?.ghBody });
    return errorResponse(err?.message || "GitHub create failed", err?.status || 500);
  }
}
