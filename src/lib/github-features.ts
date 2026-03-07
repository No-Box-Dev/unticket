import { getOctokit } from "./github";
import { apiGet, apiPut } from "./api";
import type { Feature, FeatureStatus, Effort, Priority, StatusHistoryEntry } from "./types";

const REPO = ".gitpulse";
const FEATURE_LABEL = "feature";
const STATUS_PREFIX = "status:";
const EFFORT_PREFIX = "effort:";
const PRIORITY_PREFIX = "priority:";
const TEAM_PREFIX = "team:";

const FEATURE_LABELS = [
  { name: "feature", color: "1B6971", description: "Sprint/backlog feature" },
  { name: "status:plan", color: "0E7C86", description: "Feature in planning" },
  { name: "status:demo", color: "F59E0B", description: "Feature ready for demo" },
  { name: "status:production", color: "22C55E", description: "Feature in production" },
  { name: "status:future", color: "A8A29E", description: "Backlog feature" },
  { name: "effort:low", color: "22C55E", description: "Low effort" },
  { name: "effort:medium", color: "EAB308", description: "Medium effort" },
  { name: "effort:high", color: "EF4444", description: "High effort" },
  { name: "priority:low", color: "22C55E", description: "Low priority" },
  { name: "priority:medium", color: "F97316", description: "Medium priority" },
  { name: "priority:high", color: "EF4444", description: "High priority" },
];

// ---------- Metadata (hidden in issue body) ----------

const METADATA_RE = /\n?<!-- gitpulse:metadata\n([\s\S]*?)\n-->\s*$/;

interface FeatureMetadata {
  statusHistory?: StatusHistoryEntry[];
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
  const hasData = metadata.statusHistory && metadata.statusHistory.length > 0;
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
  effort: Effort;
  priority?: Priority;
  team?: string;
}): string[] {
  const labels = [FEATURE_LABEL, `${STATUS_PREFIX}${f.status}`, `${EFFORT_PREFIX}${f.effort}`];
  if (f.priority && f.priority !== "none") labels.push(`${PRIORITY_PREFIX}${f.priority}`);
  if (f.team) labels.push(`${TEAM_PREFIX}${f.team}`);
  return labels;
}

function issueToFeature(issue: any): Feature {
  const labelNames = (issue.labels ?? [])
    .map((l: any) => (typeof l === "string" ? l : l.name))
    .filter(Boolean) as string[];

  const status = (extractLabel(labelNames, STATUS_PREFIX) as FeatureStatus) ?? "plan";
  const effort = (extractLabel(labelNames, EFFORT_PREFIX) as Effort) ?? "medium";
  const priority = extractLabel(labelNames, PRIORITY_PREFIX) as Priority | undefined;
  const team = extractLabel(labelNames, TEAM_PREFIX);

  const sprintMatch = issue.milestone?.title?.match(/^Sprint (\d+)$/);
  const sprint = sprintMatch ? parseInt(sprintMatch[1]) : null;

  const rawBody = issue.body ?? "";
  const { content, metadata } = parseMetadata(rawBody);

  return {
    id: issue.number,
    title: issue.title,
    team,
    owners: (issue.assignees ?? []).map((a: any) => a.login),
    status,
    sprint,
    effort,
    priority,
    plan: content || undefined,
    url: issue.html_url,
    statusHistory: metadata.statusHistory,
  };
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
    effort: Effort;
    team?: string;
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
}

// ---------- Sub-issues ----------

export interface SubIssue {
  id: number; // global issue ID (needed for sub-issue API)
  number: number;
  title: string;
  state: "open" | "closed";
  assignees: string[];
  html_url: string;
}

function toSubIssue(issue: any): SubIssue {
  return {
    id: issue.id,
    number: issue.number,
    title: issue.title,
    state: issue.state as "open" | "closed",
    assignees: (issue.assignees ?? []).map((a: any) => a.login),
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
    active: "plan", plan: "plan", demo: "demo",
    done: "production", production: "production", future: "future",
  };
  const effortMap: Record<string, Effort> = { low: "low", medium: "medium", high: "high" };

  let created = 0;
  for (const f of legacy) {
    const status = statusMap[f.status] ?? "plan";
    const effort = effortMap[f.effort] ?? "medium";
    const priority = (f.priority && f.priority !== "none" ? f.priority : undefined) as Priority | undefined;

    await createFeature(org, f.title, {
      status, sprint: f.sprint, effort, team: f.team,
      priority, owners: f.owners, plan: f.plan,
    });
    created++;
    onProgress?.(created, legacy.length);
  }

  // Clear legacy D1 features so migration banner doesn't reappear
  await apiPut("/api/config/features", []);

  return created;
}
