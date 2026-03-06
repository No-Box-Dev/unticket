import { getOctokit } from "./github";
import { apiGet } from "./api";
import type { Feature, FeatureStatus, Effort, Priority } from "./types";

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

  return {
    id: issue.number,
    title: issue.title,
    team,
    owners: (issue.assignees ?? []).map((a: any) => a.login),
    status,
    sprint,
    effort,
    priority,
    plan: issue.body ?? undefined,
    url: issue.html_url,
  };
}

// ---------- Milestone cache ----------

const milestoneCache = new Map<string, number>();

async function findOrCreateMilestone(org: string, sprintNumber: number): Promise<number> {
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

  const { data } = await ok.rest.issues.create({
    owner: org,
    repo: REPO,
    title,
    labels,
    milestone,
    ...(opts.owners?.length ? { assignees: opts.owners } : {}),
    ...(opts.plan ? { body: opts.plan } : {}),
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

  const { data } = await ok.rest.issues.update({
    owner: org,
    repo: REPO,
    issue_number: updated.id,
    title: updated.title,
    body: updated.plan ?? "",
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

  return created;
}
