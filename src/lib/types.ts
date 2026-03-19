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
  | "settings";

export interface NavFilter {
  person?: string;
  view?: string;
}

export type TodoStatus = "backlog" | "in_progress" | "done";

export interface Todo {
  id: number;              // GitHub issue number
  globalId: number;        // GitHub global issue ID
  title: string;
  owner: string;           // GitHub login
  status: TodoStatus;      // derived from labels
  createdAt: string;       // from GitHub created_at
  closedAt?: string;       // from GitHub closed_at (when done)
  featureId?: number;      // linked feature issue number
  repo?: string;           // optional repo context
  html_url: string;        // GitHub issue URL
}

// .gitpulse config repo types

export type Effort = "low" | "medium" | "high";
export type Priority = "high" | "medium" | "low" | "none";
export type FeatureStatus = "plan" | "in_progress" | "demo" | "tested" | "production" | "future";

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
  effort?: Effort;
  priority?: Priority;
  plan?: string;
  url?: string;
  statusHistory?: StatusHistoryEntry[];
  linkedPRs?: LinkedPR[];
}

export interface Person {
  github: string;
  name: string;
  role: string;
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
