/* eslint-disable @typescript-eslint/no-explicit-any */
import { getOctokit } from "./github";
import { apiGet, apiPost, apiPut, apiFetch } from "./api";
import { getUnticketRepoName } from "./unticket-repo-name";
import type { Feature, FeatureStatus, StatusHistoryEntry, LinkedPR } from "./types";

// D1-backed row shape returned by /api/features
interface D1FeatureRow {
  number: number;
  title: string;
  state: string;
  body: string;
  assignees: { login: string }[];
  labels: { name: string; color: string }[];
  milestone_title: string | null;
  html_url: string | null;
  updated_at?: string;
}

const FEATURE_LABEL = "feature";
const STATUS_PREFIX = "status:";

const FEATURE_LABELS = [
  { name: "feature", color: "1B6971", description: "Sprint/backlog feature" },
  { name: "status:todo", color: "94A3B8", description: "To do" },
  { name: "status:staging", color: "B89464", description: "Testing on staging" },
  { name: "status:ready", color: "6A9991", description: "Ready for production" },
  { name: "status:production", color: "6E9970", description: "On production" },
  { name: "status:future", color: "A8A29E", description: "Backlog feature" },
];

// ---------- Metadata (hidden in issue body) ----------

const METADATA_RE = /\n?<!-- unticket:metadata\n([\s\S]*?)\n-->\s*$/;

interface FeatureMetadata {
  statusHistory?: StatusHistoryEntry[];
  linkedPRs?: LinkedPR[];
}

function parseMetadata(body: string): { content: string; metadata: FeatureMetadata } {
  const match = body.match(METADATA_RE);
  if (!match) return { content: body, metadata: {} };
  try {
    const metadata = JSON.parse(match[1]) as FeatureMetadata;
    return { content: body.slice(0, match.index!), metadata };
  } catch (e) {
    console.warn("[unticket] Corrupt feature metadata block, ignoring:", e);
    return { content: body, metadata: {} };
  }
}

function serializeMetadata(content: string, metadata: FeatureMetadata): string {
  const hasData =
    (metadata.statusHistory && metadata.statusHistory.length > 0) ||
    (metadata.linkedPRs && metadata.linkedPRs.length > 0);
  if (!hasData) return content;
  return `${content}\n\n<!-- unticket:metadata\n${JSON.stringify(metadata)}\n-->`;
}

export function withStatusTransition(feature: Feature, newStatus: FeatureStatus): Feature {
  if (feature.status === newStatus) return feature;
  const history = [...(feature.statusHistory ?? [])];
  history.push({ status: newStatus, timestamp: new Date().toISOString() });
  return { ...feature, status: newStatus, statusHistory: history };
}

// ---------- Helpers ----------

function extractLabel(labels: string[], prefix: string): string | undefined {
  return labels.find((l) => l.startsWith(prefix))?.slice(prefix.length);
}

function buildLabels(f: {
  status: FeatureStatus;
}): string[] {
  return [FEATURE_LABEL, `${STATUS_PREFIX}${f.status}`];
}

function issueToFeature(issue: any): Feature {
  const labelNames = (issue.labels ?? [])
    .map((l: any) => (typeof l === "string" ? l : l.name))
    .filter(Boolean) as string[];

  const labelStatus = extractLabel(labelNames, STATUS_PREFIX) as FeatureStatus | undefined;
  const sprintMatch = issue.milestone?.title?.match(/^Sprint (\d+)$/);
  const sprint = sprintMatch ? parseInt(sprintMatch[1]) : null;

  // No sprint milestone → use label status or fall back to "future" (backlog).
  // With sprint → use label status or default to "todo".
  const status: FeatureStatus = sprint === null
    ? (labelStatus ?? "future")
    : (labelStatus ?? "todo");

  const rawBody = issue.body ?? "";
  const { content, metadata } = parseMetadata(rawBody);

  return {
    id: issue.number,
    title: issue.title,
    owners: (issue.assignees ?? []).map((a: any) => a.login),
    status,
    sprint,
    plan: content || undefined,
    url: issue.html_url,
    updatedAt: issue.updated_at,
    statusHistory: metadata.statusHistory,
    linkedPRs: metadata.linkedPRs,
  };
}

// ---------- Sync features from GitHub to D1 ----------

// Sync a single GitHub issue response to D1
async function syncIssueToD1(data: any): Promise<void> {
  await apiPut("/api/features", {
    number: data.number,
    title: data.title,
    state: data.state,
    body: data.body ?? "",
    assignees: (data.assignees ?? []).map((a: any) => ({ login: a.login })),
    labels: (data.labels ?? []).map((l: any) => ({ name: l.name, color: l.color })),
    milestone_title: data.milestone?.title ?? null,
    html_url: data.html_url,
    created_at: data.created_at,
    updated_at: data.updated_at,
  });
}

export async function syncFeaturesFromGitHub(): Promise<{ synced: number; total: number }> {
  const result = await apiPost<{ ok: boolean; synced: number; total: number }>("/api/features");
  console.log(`[unticket.ai] Feature sync: ${result.synced} features from ${result.total} issues`);
  return result;
}

// ---------- D1-backed fetch (no GitHub API calls) ----------

function d1RowToFeature(row: D1FeatureRow): Feature {
  // Adapt D1 row to the shape issueToFeature expects
  return issueToFeature({
    number: row.number,
    title: row.title,
    body: row.body,
    labels: row.labels,
    assignees: row.assignees,
    milestone: row.milestone_title ? { title: row.milestone_title } : null,
    html_url: row.html_url,
    updated_at: row.updated_at,
  });
}

export async function fetchFeaturesFromD1(): Promise<Feature[]> {
  const rows = await apiGet<D1FeatureRow[]>("/api/features?state=open");
  // Only return issues that have the "feature" label (D1 may contain stale non-feature issues)
  return rows
    .filter((row) => row.labels.some((l) => l.name === "feature"))
    .map(d1RowToFeature);
}

// ---------- Milestone cache ----------

const milestoneCache = new Map<string, number>();

export async function findOrCreateMilestone(org: string, sprintNumber: number): Promise<number> {
  const title = `Sprint ${sprintNumber}`;
  const cacheKey = `${org}/${getUnticketRepoName()}:${title}`;
  if (milestoneCache.has(cacheKey)) return milestoneCache.get(cacheKey)!;

  const ok = getOctokit();
  const { data: milestones } = await ok.rest.issues.listMilestones({
    owner: org,
    repo: getUnticketRepoName(),
    state: "all",
    per_page: 100,
  });

  const existing = milestones.find((m) => m.title === title);
  if (existing) {
    milestoneCache.set(cacheKey, existing.number);
    return existing.number;
  }

  const { data: created } = await ok.rest.issues.createMilestone({
    owner: org,
    repo: getUnticketRepoName(),
    title,
  });
  milestoneCache.set(cacheKey, created.number);
  return created.number;
}

// ---------- Label setup ----------

const labelsEnsuredByOrg = new Set<string>();

export async function ensureFeatureLabels(org: string): Promise<void> {
  if (labelsEnsuredByOrg.has(org)) return;
  const ok = getOctokit();

  const { data: existing } = await ok.rest.issues.listLabelsForRepo({
    owner: org,
    repo: getUnticketRepoName(),
    per_page: 100,
  });
  const existingNames = new Set(existing.map((l) => l.name));

  for (const label of FEATURE_LABELS) {
    if (!existingNames.has(label.name)) {
      try {
        await ok.rest.issues.createLabel({ owner: org, repo: getUnticketRepoName(), ...label });
      } catch (err: any) {
        if (err?.status !== 422) throw err;
      }
    }
  }
  labelsEnsuredByOrg.add(org);
}

// ---------- CRUD ----------

export async function fetchFeatures(org: string): Promise<Feature[]> {
  await ensureFeatureLabels(org);

  const ok = getOctokit();
  const issues = await ok.paginate(ok.rest.issues.listForRepo, {
    owner: org,
    repo: getUnticketRepoName(),
    labels: FEATURE_LABEL,
    state: "open",
    per_page: 100,
  });

  return issues.filter((i: any) => !i.pull_request).map(issueToFeature);
}

export async function createFeature(
  org: string,
  title: string,
  opts: {
    status: FeatureStatus;
    sprint: number | null;
    owners?: string[];
    plan?: string;
  },
): Promise<Feature> {
  const ok = getOctokit();
  const labels = buildLabels({ ...opts });

  let milestone: number | undefined;
  if (opts.sprint !== null) {
    milestone = await findOrCreateMilestone(org, opts.sprint);
  }

  const initialMetadata: FeatureMetadata = {
    statusHistory: [{ status: opts.status, timestamp: new Date().toISOString() }],
  };
  const body = serializeMetadata(opts.plan ?? "", initialMetadata);

  const { data } = await ok.rest.issues.create({
    owner: org,
    repo: getUnticketRepoName(),
    title,
    labels,
    milestone,
    ...(opts.owners?.length ? { assignees: opts.owners } : {}),
    body,
  });

  await syncIssueToD1(data);
  return issueToFeature(data);
}

export async function updateFeature(org: string, updated: Feature): Promise<Feature> {
  const ok = getOctokit();

  let milestone: number | null | undefined;
  if (updated.sprint !== null) {
    milestone = await findOrCreateMilestone(org, updated.sprint);
  } else {
    milestone = null;
  }

  const metadata: FeatureMetadata = {
    statusHistory: updated.statusHistory,
    linkedPRs: updated.linkedPRs,
  };
  const body = serializeMetadata(updated.plan ?? "", metadata);

  const { data } = await ok.rest.issues.update({
    owner: org,
    repo: getUnticketRepoName(),
    issue_number: updated.id,
    title: updated.title,
    body,
    assignees: updated.owners,
    labels: buildLabels(updated),
    milestone,
  });

  await syncIssueToD1(data);
  return issueToFeature(data);
}

export async function deleteFeature(org: string, issueNumber: number): Promise<void> {
  const ok = getOctokit();
  // Downgrade to regular issue: remove feature + status labels, clear milestone
  const { data: issue } = await ok.rest.issues.get({ owner: org, repo: getUnticketRepoName(), issue_number: issueNumber });
  const keepLabels = (issue.labels ?? [])
    .map((l: any) => (typeof l === "string" ? l : l.name))
    .filter((l: string) => l !== FEATURE_LABEL && !l.startsWith(STATUS_PREFIX));
  await ok.rest.issues.update({
    owner: org,
    repo: getUnticketRepoName(),
    issue_number: issueNumber,
    labels: keepLabels,
    milestone: null,
  });
  // Remove from D1 features table
  const deleteRes = await apiFetch(`/api/features?number=${issueNumber}`, { method: "DELETE" });
  if (!deleteRes.ok) {
    const body = await deleteRes.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(`Failed to delete feature from D1: ${(body as { error?: string }).error ?? deleteRes.statusText}`);
  }
}

// ---------- Milestone management ----------

export async function closeMilestone(org: string, sprintNumber: number): Promise<void> {
  const ok = getOctokit();
  const title = `Sprint ${sprintNumber}`;
  const cacheKey = `${org}/${getUnticketRepoName()}:${title}`;
  const { data: milestones } = await ok.rest.issues.listMilestones({
    owner: org,
    repo: getUnticketRepoName(),
    state: "open",
    per_page: 100,
  });
  const ms = milestones.find((m) => m.title === title);
  if (ms) {
    await ok.rest.issues.updateMilestone({
      owner: org,
      repo: getUnticketRepoName(),
      milestone_number: ms.number,
      state: "closed",
    });
    milestoneCache.delete(cacheKey);
  }
}

export async function reopenMilestone(org: string, sprintNumber: number): Promise<void> {
  const ok = getOctokit();
  const title = `Sprint ${sprintNumber}`;
  const cacheKey = `${org}/${getUnticketRepoName()}:${title}`;
  const { data: milestones } = await ok.rest.issues.listMilestones({
    owner: org,
    repo: getUnticketRepoName(),
    state: "closed",
    per_page: 100,
  });
  const ms = milestones.find((m) => m.title === title);
  if (ms) {
    await ok.rest.issues.updateMilestone({
      owner: org,
      repo: getUnticketRepoName(),
      milestone_number: ms.number,
      state: "open",
    });
    milestoneCache.set(cacheKey, ms.number);
  }
}

