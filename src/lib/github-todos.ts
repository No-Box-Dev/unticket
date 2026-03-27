import { getOctokit } from "./github";
import type { Todo, TodoStatus } from "./types";

interface GitHubIssue {
  number: number;
  id: number;
  title: string;
  state: string;
  labels: ({ name?: string } | string)[];
  assignees?: { login: string }[];
  created_at: string;
  closed_at: string | null;
  html_url: string;
  pull_request?: unknown;
}

const REPO = "gitpulse";
const TODO_LABEL = "todo";
const STATUS_PREFIX = "todo-status:";
const FEATURE_PREFIX = "todo-feature:";
const OWNER_PREFIX = "todo-owner:";

// Labels that exclude an issue from being a todo
const EXCLUDE_LABELS = new Set(["feature", "role"]);

const STATUS_LABELS = [
  { name: TODO_LABEL, color: "64748B", description: "Personal todo item" },
  { name: "todo-status:backlog", color: "94A3B8", description: "Todo: backlog" },
  { name: "todo-status:in_progress", color: "3B82F6", description: "Todo: in progress" },
  { name: "todo-status:review", color: "A855F7", description: "Todo: waiting for review" },
  { name: "todo-status:done", color: "22C55E", description: "Todo: done" },
];

// ---------- Label setup ----------

const labelsEnsuredByOrg = new Set<string>();

export async function ensureTodoLabels(org: string): Promise<void> {
  if (labelsEnsuredByOrg.has(org)) return;
  const ok = getOctokit();

  const { data: existing } = await ok.rest.issues.listLabelsForRepo({
    owner: org,
    repo: REPO,
    per_page: 100,
  });
  const existingNames = new Set(existing.map((l) => l.name));

  for (const label of STATUS_LABELS) {
    if (!existingNames.has(label.name)) {
      try {
        await ok.rest.issues.createLabel({ owner: org, repo: REPO, ...label });
      } catch (err: unknown) {
        if ((err as { status?: number })?.status !== 422) throw err;
      }
    }
  }
  labelsEnsuredByOrg.add(org);
}

// ---------- Helpers ----------

function extractLabel(labels: string[], prefix: string): string | undefined {
  return labels.find((l) => l.startsWith(prefix))?.slice(prefix.length);
}

/** Returns true if the issue should be excluded from todos (features, roles). */
function isExcluded(issue: GitHubIssue): boolean {
  const labelNames = (issue.labels ?? [])
    .map((l) => (typeof l === "string" ? l : l.name))
    .filter(Boolean) as string[];
  return labelNames.some((l) => EXCLUDE_LABELS.has(l));
}

function issueToTodo(issue: GitHubIssue): Todo {
  const labelNames = (issue.labels ?? [])
    .map((l) => (typeof l === "string" ? l : l.name))
    .filter(Boolean) as string[];

  const statusLabel = extractLabel(labelNames, STATUS_PREFIX) as TodoStatus | undefined;
  const owner = issue.assignees?.[0]?.login ?? "";
  const featureStr = extractLabel(labelNames, FEATURE_PREFIX);

  // Derive status: if issue is closed → done, else use label or default to backlog
  let status: TodoStatus;
  if (issue.state === "closed") {
    status = "done";
  } else {
    status = statusLabel ?? "backlog";
  }

  return {
    id: issue.number,
    globalId: issue.id,
    title: issue.title,
    owner,
    status,
    createdAt: issue.created_at,
    closedAt: issue.closed_at ?? undefined,
    featureId: featureStr ? parseInt(featureStr) : undefined,
    html_url: issue.html_url,
  };
}

// ---------- Ensure dynamic labels exist ----------

const dynamicLabelsEnsured = new Set<string>();

async function ensureDynamicLabel(org: string, name: string, color: string, description: string): Promise<void> {
  const cacheKey = `${org}:${name}`;
  if (dynamicLabelsEnsured.has(cacheKey)) return;
  const ok = getOctokit();
  try {
    await ok.rest.issues.createLabel({ owner: org, repo: REPO, name, color, description });
  } catch (err: unknown) {
    if ((err as { status?: number })?.status !== 422) throw err; // 422 = already exists
  }
  dynamicLabelsEnsured.add(cacheKey);
}

// ---------- CRUD ----------

export async function fetchTodos(org: string): Promise<Todo[]> {
  await ensureTodoLabels(org);

  const ok = getOctokit();
  // Fetch all assigned issues (open + recently closed), then exclude features/roles
  const [open, closed] = await Promise.all([
    ok.paginate(ok.rest.issues.listForRepo, {
      owner: org,
      repo: REPO,
      labels: TODO_LABEL,
      state: "open",
      per_page: 100,
    }),
    ok.paginate(ok.rest.issues.listForRepo, {
      owner: org,
      repo: REPO,
      labels: TODO_LABEL,
      state: "closed",
      per_page: 100,
      since: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(), // last 90 days
    }),
  ]);

  const all = [...open, ...closed].filter((i) =>
    !i.pull_request &&
    !isExcluded(i as GitHubIssue) &&
    (i.assignees?.length ?? 0) > 0
  );
  return all.map(issueToTodo);
}

export async function fetchTodosByOwner(org: string, login: string): Promise<Todo[]> {
  const all = await fetchTodos(org);
  return all.filter((t) => t.owner === login);
}

export async function createTodo(
  org: string,
  title: string,
  owner: string,
  opts?: { featureId?: number },
): Promise<Todo> {
  await ensureTodoLabels(org);
  const ok = getOctokit();

  const ownerLabel = `${OWNER_PREFIX}${owner}`;
  await ensureDynamicLabel(org, ownerLabel, "64748B", `Todo owner: ${owner}`);
  const labels: string[] = [TODO_LABEL, `${STATUS_PREFIX}backlog`, ownerLabel];
  if (opts?.featureId) {
    const featureLabel = `${FEATURE_PREFIX}${opts.featureId}`;
    await ensureDynamicLabel(org, featureLabel, "7C3AED", `Linked to feature #${opts.featureId}`);
    labels.push(featureLabel);
  }
  const { data } = await ok.rest.issues.create({
    owner: org,
    repo: REPO,
    title,
    labels,
    assignees: [owner],
  });

  return issueToTodo(data);
}

export async function updateTodo(
  org: string,
  issueNumber: number,
  updates: {
    title?: string;
    status?: TodoStatus;
    featureId?: number | null;
  },
): Promise<Todo> {
  const ok = getOctokit();

  // Get current issue to read existing labels
  const { data: current } = await ok.rest.issues.get({
    owner: org,
    repo: REPO,
    issue_number: issueNumber,
  });

  const currentLabels = (current.labels ?? [])
    .map((l) => (typeof l === "string" ? l : (l as { name?: string }).name))
    .filter(Boolean) as string[];

  // Rebuild labels — keep non-todo labels, rebuild status/feature
  const newLabels = currentLabels.filter(
    (l) =>
      !l.startsWith(STATUS_PREFIX) &&
      !l.startsWith(FEATURE_PREFIX),
  );

  const status = updates.status ?? (extractLabel(currentLabels, STATUS_PREFIX) as TodoStatus) ?? "backlog";
  newLabels.push(`${STATUS_PREFIX}${status}`);

  if (updates.featureId !== undefined) {
    if (updates.featureId !== null) {
      const featureLabel = `${FEATURE_PREFIX}${updates.featureId}`;
      await ensureDynamicLabel(org, featureLabel, "7C3AED", `Linked to feature #${updates.featureId}`);
      newLabels.push(featureLabel);
    }
  } else {
    // Preserve existing feature label
    const existing = currentLabels.find((l) => l.startsWith(FEATURE_PREFIX));
    if (existing) newLabels.push(existing);
  }

  // Handle state change for done status
  let state: "open" | "closed" | undefined;
  if (updates.status === "done") {
    state = "closed";
  } else if (updates.status && current.state === "closed") {
    state = "open";
  }

  const { data } = await ok.rest.issues.update({
    owner: org,
    repo: REPO,
    issue_number: issueNumber,
    ...(updates.title ? { title: updates.title } : {}),
    labels: newLabels,
    ...(state ? { state } : {}),
  });

  return issueToTodo(data);
}

export async function closeTodo(org: string, issueNumber: number): Promise<Todo> {
  return updateTodo(org, issueNumber, { status: "done" });
}

export async function reopenTodo(org: string, issueNumber: number): Promise<Todo> {
  return updateTodo(org, issueNumber, { status: "in_progress" });
}

export async function deleteTodo(org: string, issueNumber: number): Promise<void> {
  const ok = getOctokit();
  await ok.rest.issues.update({
    owner: org,
    repo: REPO,
    issue_number: issueNumber,
    state: "closed",
  });
}

// ---------- Sprint integration ----------

export async function fetchTodosClosedInRange(
  org: string,
  login: string | null,
  startDate: string,
  endDate: string,
): Promise<Todo[]> {
  const ok = getOctokit();

  const issues = await ok.paginate(ok.rest.issues.listForRepo, {
    owner: org,
    repo: REPO,
    labels: TODO_LABEL,
    state: "closed",
    since: startDate,
    per_page: 100,
  });

  const endDateEnd = endDate + "T23:59:59Z";

  return (issues as GitHubIssue[])
    .filter((i) => !i.pull_request && !isExcluded(i) && (i.assignees?.length ?? 0) > 0)
    .filter((i) => {
      if (!i.closed_at) return false;
      return i.closed_at >= startDate && i.closed_at <= endDateEnd;
    })
    .map(issueToTodo)
    .filter((t) => login === null || t.owner === login);
}

// ---------- Migration ----------

export interface LegacyTodoForMigration {
  id: string;
  title: string;
  owner: string;
  status: TodoStatus;
  createdAt: string;
  featureId?: string;
}

export async function migrateTodos(
  org: string,
  legacy: LegacyTodoForMigration[],
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  await ensureTodoLabels(org);

  let created = 0;
  for (const t of legacy) {
    const featureId = t.featureId ? parseInt(t.featureId) : undefined;
    const todo = await createTodo(org, t.title, t.owner, {
      featureId: featureId && !isNaN(featureId) ? featureId : undefined,
    });

    // If status is in_progress, update it
    if (t.status === "in_progress") {
      await updateTodo(org, todo.id, { status: "in_progress" });
    }
    // If done, close it
    if (t.status === "done") {
      await closeTodo(org, todo.id);
    }

    created++;
    onProgress?.(created, legacy.length);
  }

  return created;
}
