import { getOctokit } from "./github";
import { apiGet, apiPost, apiPut, apiFetch } from "./api";
import type { Feature, FeatureStatus, Effort, Priority, StatusHistoryEntry, Points, PersonRole, LinkedPR } from "./types";
import { VALID_POINTS } from "./types";

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
}

const REPO = ".gitpulse";
const FEATURE_LABEL = "feature";
const STATUS_PREFIX = "status:";
const EFFORT_PREFIX = "effort:";
const PRIORITY_PREFIX = "priority:";
const ROLE_LABEL = "role";
const POINTS_PREFIX = "points:";

const FEATURE_LABELS = [
  { name: "feature", color: "1B6971", description: "Sprint/backlog feature" },
  { name: "status:plan", color: "0E7C86", description: "Feature in planning" },
  { name: "status:in_progress", color: "F59E0B", description: "Feature in progress" },
  { name: "status:demo", color: "A855F7", description: "Feature ready for demo" },
  { name: "status:tested", color: "06B6D4", description: "Feature tested" },
  { name: "status:production", color: "22C55E", description: "Feature in production" },
  { name: "status:future", color: "A8A29E", description: "Backlog feature" },
  { name: "priority:low", color: "22C55E", description: "Low priority" },
  { name: "priority:medium", color: "F97316", description: "Medium priority" },
  { name: "priority:high", color: "EF4444", description: "High priority" },
  { name: "role", color: "6366F1", description: "Person role (sub-issue grouping)" },
  { name: "points:1", color: "22C55E", description: "1 sprint point" },
  { name: "points:2", color: "84CC16", description: "2 sprint points" },
  { name: "points:3", color: "EAB308", description: "3 sprint points" },
  { name: "points:5", color: "F97316", description: "5 sprint points" },
  { name: "points:8", color: "EF4444", description: "8 sprint points" },
  { name: "points:13", color: "DC2626", description: "13 sprint points" },
];

// ---------- Metadata (hidden in issue body) ----------

const METADATA_RE = /\n?<!-- gitpulse:metadata\n([\s\S]*?)\n-->\s*$/;

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
  } catch {
    return { content: body, metadata: {} };
  }
}

function serializeMetadata(content: string, metadata: FeatureMetadata): string {
  const hasData =
    (metadata.statusHistory && metadata.statusHistory.length > 0) ||
    (metadata.linkedPRs && metadata.linkedPRs.length > 0);
  if (!hasData) return content;
  return `${content}\n\n<!-- gitpulse:metadata\n${JSON.stringify(metadata)}\n-->`;
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
  effort?: Effort;
  priority?: Priority;
}): string[] {
  const labels = [FEATURE_LABEL, `${STATUS_PREFIX}${f.status}`];
  if (f.priority && f.priority !== "none") labels.push(`${PRIORITY_PREFIX}${f.priority}`);
  return labels;
}

function issueToFeature(issue: any): Feature {
  const labelNames = (issue.labels ?? [])
    .map((l: any) => (typeof l === "string" ? l : l.name))
    .filter(Boolean) as string[];

  const labelStatus = extractLabel(labelNames, STATUS_PREFIX) as FeatureStatus | undefined;
  const effort = extractLabel(labelNames, EFFORT_PREFIX) as Effort | undefined;
  const priority = extractLabel(labelNames, PRIORITY_PREFIX) as Priority | undefined;
  const sprintMatch = issue.milestone?.title?.match(/^Sprint (\d+)$/);
  const sprint = sprintMatch ? parseInt(sprintMatch[1]) : null;

  // No sprint milestone → future (backlog). With sprint → use label status or default to plan.
  const status: FeatureStatus = sprint === null ? "future" : (labelStatus ?? "plan");

  const rawBody = issue.body ?? "";
  const { content, metadata } = parseMetadata(rawBody);

  return {
    id: issue.number,
    title: issue.title,
    owners: (issue.assignees ?? []).map((a: any) => a.login),
    status,
    sprint,
    effort,
    priority,
    plan: content || undefined,
    url: issue.html_url,
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
  });
}

export async function fetchFeaturesFromD1(): Promise<Feature[]> {
  const rows = await apiGet<D1FeatureRow[]>("/api/features?state=open");
  return rows.map(d1RowToFeature);
}

// ---------- Milestone cache ----------

const milestoneCache = new Map<string, number>();

export async function findOrCreateMilestone(org: string, sprintNumber: number): Promise<number> {
  const title = `Sprint ${sprintNumber}`;
  const cacheKey = `${org}/${REPO}:${title}`;
  if (milestoneCache.has(cacheKey)) return milestoneCache.get(cacheKey)!;

  const ok = getOctokit();
  const { data: milestones } = await ok.rest.issues.listMilestones({
    owner: org,
    repo: REPO,
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
    repo: REPO,
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
    repo: REPO,
    per_page: 100,
  });
  const existingNames = new Set(existing.map((l) => l.name));

  for (const label of FEATURE_LABELS) {
    if (!existingNames.has(label.name)) {
      try {
        await ok.rest.issues.createLabel({ owner: org, repo: REPO, ...label });
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
    repo: REPO,
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
    effort?: Effort;
    priority?: Priority;
    owners?: string[];
    plan?: string;
  },
): Promise<Feature> {
  const ok = getOctokit();
  const labels = buildLabels({ ...opts, priority: opts.priority });

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
    repo: REPO,
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
    repo: REPO,
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
  await ok.rest.issues.update({
    owner: org,
    repo: REPO,
    issue_number: issueNumber,
    state: "closed",
  });
  // Also mark as closed in D1 so it doesn't reappear on refetch
  await apiFetch(`/api/features?number=${issueNumber}`, { method: "DELETE" });
}

// ---------- Sub-issues ----------

export interface SubIssue {
  id: number; // global issue ID (needed for sub-issue API)
  number: number;
  title: string;
  state: "open" | "closed";
  assignees: string[];
  html_url: string;
  points?: Points;
  roleNumber?: number;
}

function extractPoints(labels: string[]): Points | undefined {
  for (const l of labels) {
    if (l.startsWith(POINTS_PREFIX)) {
      const n = parseInt(l.slice(POINTS_PREFIX.length));
      if (VALID_POINTS.includes(n as Points)) return n as Points;
    }
  }
  return undefined;
}

function toSubIssue(issue: any): SubIssue {
  const labelNames = (issue.labels ?? [])
    .map((l: any) => (typeof l === "string" ? l : l.name))
    .filter(Boolean) as string[];
  return {
    id: issue.id,
    number: issue.number,
    title: issue.title,
    state: issue.state as "open" | "closed",
    assignees: (issue.assignees ?? []).map((a: any) => a.login),
    html_url: issue.html_url,
    points: extractPoints(labelNames),
  };
}

function isRoleIssue(issue: any): boolean {
  const labelNames = (issue.labels ?? [])
    .map((l: any) => (typeof l === "string" ? l : l.name))
    .filter(Boolean) as string[];
  return labelNames.includes(ROLE_LABEL);
}

function toPersonRole(issue: any): PersonRole {
  return {
    id: issue.id,
    number: issue.number,
    title: issue.title,
    assignee: issue.assignees?.[0]?.login ?? null,
    state: issue.state as "open" | "closed",
    html_url: issue.html_url,
  };
}

export async function fetchSubIssues(org: string, issueNumber: number): Promise<SubIssue[]> {
  const ok = getOctokit();
  const { data } = await ok.request("GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues", {
    owner: org,
    repo: REPO,
    issue_number: issueNumber,
    per_page: 100,
  });
  return (data as any[]).map(toSubIssue);
}

export async function createSubIssue(
  org: string,
  parentIssueNumber: number,
  title: string,
  assignees?: string[],
): Promise<SubIssue> {
  const ok = getOctokit();
  // 1. Create a new issue
  const { data: issue } = await ok.rest.issues.create({
    owner: org,
    repo: REPO,
    title,
    ...(assignees?.length ? { assignees } : {}),
  });
  // 2. Link it as sub-issue (needs global ID, not issue number)
  await ok.request("POST /repos/{owner}/{repo}/issues/{issue_number}/sub_issues", {
    owner: org,
    repo: REPO,
    issue_number: parentIssueNumber,
    sub_issue_id: issue.id,
  });
  return toSubIssue(issue);
}

export async function toggleSubIssue(org: string, subIssue: SubIssue): Promise<SubIssue> {
  const ok = getOctokit();
  const newState = subIssue.state === "open" ? "closed" : "open";
  const { data } = await ok.rest.issues.update({
    owner: org,
    repo: REPO,
    issue_number: subIssue.number,
    state: newState,
  });
  return toSubIssue(data);
}

export async function updateSubIssueAssignees(
  org: string,
  subIssueNumber: number,
  assignees: string[],
): Promise<SubIssue> {
  const ok = getOctokit();
  const { data } = await ok.rest.issues.update({
    owner: org,
    repo: REPO,
    issue_number: subIssueNumber,
    assignees,
  });
  return toSubIssue(data);
}

export async function deleteSubIssue(org: string, subIssueNumber: number): Promise<void> {
  const ok = getOctokit();
  await ok.rest.issues.update({
    owner: org,
    repo: REPO,
    issue_number: subIssueNumber,
    state: "closed",
  });
}

// ---------- Roles (Person Role sub-issues) ----------

export async function fetchRoles(org: string, featureNumber: number): Promise<PersonRole[]> {
  const ok = getOctokit();
  const { data } = await ok.request("GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues", {
    owner: org,
    repo: REPO,
    issue_number: featureNumber,
    per_page: 100,
  });
  return (data as any[]).filter(isRoleIssue).map(toPersonRole);
}

export async function createRole(
  org: string,
  featureNumber: number,
  title: string,
  assignee?: string,
): Promise<PersonRole> {
  const ok = getOctokit();
  const { data: issue } = await ok.rest.issues.create({
    owner: org,
    repo: REPO,
    title,
    labels: [ROLE_LABEL],
    ...(assignee ? { assignees: [assignee] } : {}),
  });
  await ok.request("POST /repos/{owner}/{repo}/issues/{issue_number}/sub_issues", {
    owner: org,
    repo: REPO,
    issue_number: featureNumber,
    sub_issue_id: issue.id,
  });
  return toPersonRole(issue);
}

export async function deleteRole(org: string, roleNumber: number): Promise<void> {
  const ok = getOctokit();
  await ok.rest.issues.update({
    owner: org,
    repo: REPO,
    issue_number: roleNumber,
    state: "closed",
  });
}

export async function fetchTasksForRole(org: string, roleNumber: number): Promise<SubIssue[]> {
  const ok = getOctokit();
  const { data } = await ok.request("GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues", {
    owner: org,
    repo: REPO,
    issue_number: roleNumber,
    per_page: 100,
  });
  return (data as any[]).map((issue: any) => ({
    ...toSubIssue(issue),
    roleNumber,
  }));
}

export async function createTask(
  org: string,
  roleNumber: number,
  title: string,
  points?: Points,
  assignee?: string,
): Promise<SubIssue> {
  const ok = getOctokit();
  const labels: string[] = [];
  if (points) labels.push(`${POINTS_PREFIX}${points}`);
  const { data: issue } = await ok.rest.issues.create({
    owner: org,
    repo: REPO,
    title,
    labels,
    ...(assignee ? { assignees: [assignee] } : {}),
  });
  await ok.request("POST /repos/{owner}/{repo}/issues/{issue_number}/sub_issues", {
    owner: org,
    repo: REPO,
    issue_number: roleNumber,
    sub_issue_id: issue.id,
  });
  return { ...toSubIssue(issue), roleNumber };
}

export async function updateTaskPoints(org: string, taskNumber: number, points: Points | undefined): Promise<SubIssue> {
  const ok = getOctokit();
  // Get current labels, remove old points labels, add new one
  const { data: issue } = await ok.rest.issues.get({
    owner: org,
    repo: REPO,
    issue_number: taskNumber,
  });
  const currentLabels = (issue.labels ?? [])
    .map((l: any) => (typeof l === "string" ? l : l.name))
    .filter((l: string) => !l.startsWith(POINTS_PREFIX));
  if (points) currentLabels.push(`${POINTS_PREFIX}${points}`);
  const { data: updated } = await ok.rest.issues.update({
    owner: org,
    repo: REPO,
    issue_number: taskNumber,
    labels: currentLabels,
  });
  return toSubIssue(updated);
}

// ---------- Milestone management ----------

export async function closeMilestone(org: string, sprintNumber: number): Promise<void> {
  const ok = getOctokit();
  const title = `Sprint ${sprintNumber}`;
  const cacheKey = `${org}/${REPO}:${title}`;
  const { data: milestones } = await ok.rest.issues.listMilestones({
    owner: org,
    repo: REPO,
    state: "open",
    per_page: 100,
  });
  const ms = milestones.find((m) => m.title === title);
  if (ms) {
    await ok.rest.issues.updateMilestone({
      owner: org,
      repo: REPO,
      milestone_number: ms.number,
      state: "closed",
    });
    milestoneCache.delete(cacheKey);
  }
}

// ---------- Migration ----------

export async function fetchLegacyFeatures(): Promise<LegacyFeature[]> {
  const data = await apiGet<LegacyFeature[] | null>("/api/config/features");
  return data ?? [];
}

export interface LegacyFeature {
  id: string;
  title: string;
  team?: string;
  owners: string[];
  status: string;
  sprint: number | null;
  effort: string;
  priority?: string;
  plan?: string;
}

export async function migrateFeatures(
  org: string,
  legacy: LegacyFeature[],
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  await ensureFeatureLabels(org);

  const statusMap: Record<string, FeatureStatus> = {
    active: "in_progress", plan: "plan", in_progress: "in_progress",
    demo: "demo", tested: "tested",
    done: "production", production: "production", future: "future",
  };
  const effortMap: Record<string, Effort> = { low: "low", medium: "medium", high: "high" };

  let created = 0;
  for (const f of legacy) {
    const status = statusMap[f.status] ?? "plan";
    const effort = effortMap[f.effort] ?? "medium";
    const priority = (f.priority && f.priority !== "none" ? f.priority : undefined) as Priority | undefined;

    await createFeature(org, f.title, {
      status, sprint: f.sprint, effort,
      priority, owners: f.owners, plan: f.plan,
    });
    created++;
    onProgress?.(created, legacy.length);
  }

  // Clear legacy D1 features so migration banner doesn't reappear
  await apiPut("/api/config/features", []);

  return created;
}
