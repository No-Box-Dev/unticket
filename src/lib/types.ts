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
  | "sprint"
  | "prs"
  | "issues"
  | "posts"
  | "repos"
  | "engineers"
  | "settings";

export interface NavFilter {
  person?: string;
  view?: string;
}

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

/** Cross-repo issue assigned to the user (sourced from D1, not unticket repo) */
export interface AssignedIssue {
  repo: string;
  number: number;
  title: string;
  state: "open" | "closed";
  html_url: string;
  labels: { name: string; color: string }[];
  created_at: string;
}

// unticket config repo types

// Status IDs are now admin-configurable per org (see BoardStage + useBoardStages).
// The default ids match the historical scheme so existing features keep working
// before an admin customises anything.
export type FeatureStatus = string;

/** An admin-configurable board column. `id` is the GitHub label suffix (`status:<id>`). */
export interface BoardStage {
  id: string;
  label: string;
  color: string; // hex, e.g. "#94a3b8"
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
  excludedMembers?: string[];
  unticketRepo?: string;
  boardStages?: BoardStage[];
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
