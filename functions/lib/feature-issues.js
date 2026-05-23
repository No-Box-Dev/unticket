// Server-side helpers for the feature kanban (issues in {org}/unticket).
//
// Mirrors src/lib/github-features.ts's label/body conventions so that the
// frontend can talk to /api/features instead of calling Octokit directly.
// Keeping both sides in lock-step matters: the kanban column an issue lands
// in is derived from labels, so any divergence here would silently misroute
// cards.

import { parseFeatureMetadata, serializeFeatureMetadata } from "./feature-metadata.js";

export const UNTICKET_REPO = "unticket";
export const UNTICKET_LABEL = "unticket";
export const FEATURE_LABEL = "feature";
const STATUS_PREFIX = "status:";

export const FEATURE_LABELS = [
  { name: "unticket", color: "1B6971", description: "Tracked by unticket.ai" },
  { name: "feature", color: "1B6971", description: "Feature managed by unticket.ai" },
  { name: "status:staging", color: "B89464", description: "Testing on staging" },
  { name: "status:ready", color: "6A9991", description: "Ready for production" },
  { name: "status:production", color: "6E9970", description: "On production" },
  { name: "status:future", color: "A8A29E", description: "Backlog feature" },
];

export const VALID_STATUSES = new Set(["todo", "staging", "ready", "production", "future"]);

// "todo" is the implicit default — no explicit status label. Only emit a
// `status:*` label for the non-default columns.
export function buildFeatureLabels(status) {
  const labels = [UNTICKET_LABEL, FEATURE_LABEL];
  if (status && status !== "todo") labels.push(`${STATUS_PREFIX}${status}`);
  return labels;
}

export function extractStatusFromLabels(labels) {
  const names = (labels ?? [])
    .map((l) => (typeof l === "string" ? l : l?.name))
    .filter(Boolean);
  const found = names.find((n) => n.startsWith(STATUS_PREFIX));
  return found ? found.slice(STATUS_PREFIX.length) : "todo";
}

const GH_HEADERS = (token) => ({
  Authorization: `Bearer ${token}`,
  "User-Agent": "Unticket",
  Accept: "application/vnd.github+json",
});

async function ghFetch(url, init, token) {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...GH_HEADERS(token),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body?.message || `GitHub ${res.status} ${res.statusText}`);
    err.status = res.status;
    err.ghBody = body;
    throw err;
  }
  return res.json();
}

// Per-org cache: only run the label backfill once per Worker isolate per org.
// On a cold start we'll re-check, which is fine — createLabel is idempotent.
const labelsEnsuredByOrg = new Set();

export async function ensureUnticketRepoLabels(token, orgLogin) {
  if (labelsEnsuredByOrg.has(orgLogin)) return;
  const existing = await ghFetch(
    `https://api.github.com/repos/${encodeURIComponent(orgLogin)}/${UNTICKET_REPO}/labels?per_page=100`,
    { method: "GET" },
    token,
  );
  const existingNames = new Set(existing.map((l) => l.name));
  for (const label of FEATURE_LABELS) {
    if (existingNames.has(label.name)) continue;
    try {
      await ghFetch(
        `https://api.github.com/repos/${encodeURIComponent(orgLogin)}/${UNTICKET_REPO}/labels`,
        { method: "POST", body: JSON.stringify(label) },
        token,
      );
    } catch (err) {
      // 422 = "already_exists" race; safe to ignore.
      if (err?.status !== 422) throw err;
    }
  }
  labelsEnsuredByOrg.add(orgLogin);
}

export async function createFeatureIssue(token, orgLogin, payload) {
  return ghFetch(
    `https://api.github.com/repos/${encodeURIComponent(orgLogin)}/${UNTICKET_REPO}/issues`,
    { method: "POST", body: JSON.stringify(payload) },
    token,
  );
}

export async function patchFeatureIssue(token, orgLogin, number, payload) {
  return ghFetch(
    `https://api.github.com/repos/${encodeURIComponent(orgLogin)}/${UNTICKET_REPO}/issues/${number}`,
    { method: "PATCH", body: JSON.stringify(payload) },
    token,
  );
}

// Build the body GitHub will store — plan content followed by the metadata
// HTML comment block. Empty metadata returns just the plan.
export function buildIssueBody(plan, metadata) {
  return serializeFeatureMetadata(plan ?? "", metadata ?? {});
}

// Read the current feature row from D1 (or null) — used by PATCH to preserve
// metadata (linkedPRs from manual matches) and compare the old status.
export async function readFeatureRow(db, orgId, number) {
  return db
    .prepare(
      `SELECT number, title, state, body, assignees_json, labels_json, milestone_title, html_url, created_at, updated_at
         FROM features WHERE org_id = ? AND number = ?`,
    )
    .bind(orgId, number)
    .first();
}

// Mirror a GitHub issue response into the features table. Same column set as
// the webhook handler, so /api/features?state=open reads consistently
// regardless of which path wrote the row.
export async function upsertFeatureRow(db, orgId, ghIssue) {
  const assignees = (ghIssue.assignees ?? []).map((a) => ({
    login: a.login,
    avatar_url: a.avatar_url || "",
  }));
  const labels = (ghIssue.labels ?? []).map((l) => ({ name: l.name, color: l.color }));
  await db
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
         updated_at = excluded.updated_at`,
    )
    .bind(
      orgId,
      ghIssue.number,
      ghIssue.title,
      ghIssue.state ?? "open",
      ghIssue.body ?? "",
      JSON.stringify(assignees),
      JSON.stringify(labels),
      ghIssue.milestone?.title ?? null,
      ghIssue.html_url ?? null,
      ghIssue.created_at ?? new Date().toISOString(),
      ghIssue.updated_at ?? new Date().toISOString(),
    )
    .run();
}

// Convert a GitHub issue response to the Feature shape the frontend uses.
// Caller passes linkedPRs hydrated from pr_feature_links; metadata.linkedPRs
// is a fallback for issues that only have the body-embedded list.
export function ghIssueToFeature(ghIssue, linkedPRs) {
  const { content, metadata } = parseFeatureMetadata(ghIssue.body ?? "");
  return {
    id: ghIssue.number,
    title: ghIssue.title,
    owners: (ghIssue.assignees ?? []).map((a) => a.login),
    status: extractStatusFromLabels(ghIssue.labels),
    plan: content || undefined,
    url: ghIssue.html_url ?? undefined,
    updatedAt: ghIssue.updated_at,
    statusHistory: metadata.statusHistory,
    linkedPRs: linkedPRs && linkedPRs.length > 0 ? linkedPRs : metadata.linkedPRs,
  };
}

export async function readLinkedPRs(db, orgId, number) {
  const rows = await db
    .prepare(
      "SELECT pr_repo AS repo, pr_number AS number FROM pr_feature_links WHERE org_id = ? AND feature_number = ?",
    )
    .bind(orgId, number)
    .all();
  return (rows.results ?? []).map((r) => ({ repo: r.repo, number: r.number }));
}
