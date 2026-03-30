export interface OrgInfo {
  login: string;
  avatar_url: string;
  description: string | null;
}

export interface RepoInfo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  open_issues_count: number;
  pushed_at: string | null;
  language: string | null;
  visibility: string;
}

export interface PRInfo {
  id: number;
  number: number;
  title: string;
  state: string;
  created_at: string;
  updated_at: string;
  user: { login: string; avatar_url: string } | null;
  labels: { name: string; color: string }[];
  draft: boolean;
  requested_reviewers: { login: string }[];
  head: { ref: string; repo: { name: string; full_name: string } | null };
  base: { ref: string };
  html_url: string;
}

export interface IssueInfo {
  id: number;
  number: number;
  title: string;
  state: string;
  created_at: string;
  updated_at: string;
  user: { login: string; avatar_url: string } | null;
  labels: { name: string; color: string }[];
  assignees: { login: string; avatar_url: string }[];
  milestone: { title: string } | null;
  html_url: string;
}

export type TabId =
  | "overview"
  | "sprint"
  | "backlog"
  | "prs"
  | "issues"
  | "todos"
  | "engineers"
  | "workload"
  | "releases"
  | "settings";

export interface NavFilter {
  person?: string;
  view?: string;
}

export type TodoStatus = "backlog" | "in_progress" | "review" | "done";

/** PR where the user is a requested reviewer */
export interface ReviewPR {
  repo: string;
  number: number;
  title: string;
  state: string;
  draft: boolean;
  merged_at: string | null;
  html_url: string;
  author: string | null;
  created_at: string;
}

/** Cross-repo issue assigned to the user (sourced from D1, not gitpulse repo) */
export interface AssignedIssue {
  repo: string;
  number: number;
  title: string;
  state: "open" | "closed";
  html_url: string;
  labels: { name: string; color: string }[];
  created_at: string;
}

export interface Todo {
  id: number;              // GitHub issue number
  globalId: number;        // GitHub global issue ID
  title: string;
  owner: string;           // GitHub login
  status: TodoStatus;      // derived from labels
  createdAt: string;       // from GitHub created_at
  closedAt?: string;       // from GitHub closed_at (when done)
  featureId?: number;      // linked feature issue number
  html_url: string;        // GitHub issue URL
}

// gitpulse config repo types

export type FeatureStatus = "plan" | "in_progress" | "demo" | "tested" | "production" | "future" | "idea" | "client_scoping" | "technical_scoping" | "planning" | "planned" | "deferred";

/** Ordered feature statuses for kanban boards (excludes "future" which is backlog-only, and scoping statuses). */
export const FEATURE_STATUS_ORDER: FeatureStatus[] = ["plan", "in_progress", "demo", "tested", "production"];

/** Scoping board statuses in column order. */
export type ScopingStatus = "idea" | "client_scoping" | "technical_scoping" | "planning" | "planned" | "deferred";
export const SCOPING_STATUS_ORDER: ScopingStatus[] = ["idea", "client_scoping", "technical_scoping", "planning", "planned", "deferred"];

/** Tailwind background color class for each feature status dot/indicator. */
export const STATUS_COLORS: Record<FeatureStatus, string> = {
  plan: "bg-brand",
  in_progress: "bg-amber-500",
  demo: "bg-purple-500",
  tested: "bg-cyan-500",
  production: "bg-green-500",
  future: "bg-stone-300",
  idea: "bg-slate-400",
  client_scoping: "bg-pink-400",
  technical_scoping: "bg-indigo-400",
  planning: "bg-orange-400",
  planned: "bg-emerald-400",
  deferred: "bg-gray-500",
};

/** Human-readable display label for each feature status. */
export const STATUS_LABELS: Record<FeatureStatus, string> = {
  plan: "Plan",
  in_progress: "In Progress",
  demo: "Demo",
  tested: "Tested",
  production: "In Production",
  future: "Future",
  idea: "Idea",
  client_scoping: "Client Scoping",
  technical_scoping: "Technical Scoping",
  planning: "Planning",
  planned: "Planned",
  deferred: "Deferred",
};

// Sprint points
export type Points = 1 | 2 | 3 | 5 | 8 | 13;
export const VALID_POINTS: Points[] = [1, 2, 3, 5, 8, 13];

export interface PersonRole {
  id: number;        // GitHub global issue ID
  number: number;    // issue number
  title: string;
  assignee: string | null;
  state: "open" | "closed";
  html_url: string;
}

export interface SprintConfig {
  number: number;
  name: string;
  startDate: string;
  endDate: string;
  focus: string;
}

export interface StatusHistoryEntry {
  status: FeatureStatus;
  timestamp: string; // ISO 8601
}

export interface LinkedPR {
  repo: string;
  number: number;
}

export interface Feature {
  id: number;
  title: string;
  owners: string[];
  status: FeatureStatus;
  sprint: number | null;
  plan?: string;
  url?: string;
  updatedAt?: string;
  statusHistory?: StatusHistoryEntry[];
  linkedPRs?: LinkedPR[];
}

export interface Person {
  github: string;
  name: string;
  role: string;
  team?: string;
  description?: string;
}

export interface OrgSettings {
  draftRepos?: string[];
  excludedMembers?: string[];
}

// Sprint snapshots
export interface SprintSnapshot {
  sprintNumber: number;
  name: string;
  startDate: string;
  endDate: string;
  focus: string;
  metrics: {
    prsMerged: number;
    issuesCreated: number;
    issuesClosed: number;
    featuresCompleted: number;
    featuresCarriedOver: number;
    tasksDone: number;
    tasksOpen: number;
    totalPoints: number;
    donePoints: number;
    rolesCompleted: number;
    totalRoles: number;
  };
  features: {
    title: string;
    status: FeatureStatus;
    owners: string[];
  }[];
  /** Per-engineer breakdown saved at sprint close */
  engineers?: {
    login: string;
    tasksDone: number;
    tasksOpen: number;
    points: number;
    prsMerged: number;
    issuesClosed: number;
  }[];
  /** Personal todos completed during this sprint */
  todosCompleted?: {
    title: string;
    owner: string;
    closedAt: string;
    featureId?: number;
  }[];
  /** All PRs merged during this sprint */
  prsMerged?: {
    number: number;
    title: string;
    repo: string;
    author: string;
    mergedAt: string;
    url?: string;
  }[];
  /** All issues closed during this sprint */
  issuesClosed?: {
    number: number;
    title: string;
    repo: string;
    closedBy?: string;
    closedAt: string;
    url?: string;
  }[];
  createdAt: string;
}

// Extended issue info with repo context
export interface IssueWithRepo extends IssueInfo {
  repo: string;
}

// Metric types
export interface WeeklyBucket {
  weekStart: string;
  value: number;
}

export interface MetricData {
  current: number;
  previous: number;
  change: number;
  history: WeeklyBucket[];
}
