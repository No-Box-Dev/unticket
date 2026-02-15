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
  | "backlog"
  | "team"
  | "individual"
  | "prs"
  | "issues"
  | "activity";

// .gitpulse config repo types

export type Effort = "low" | "medium" | "high";
export type Priority = "high" | "medium" | "low" | "none";
export type FeatureStatus = "active" | "done" | "future";

export interface SprintConfig {
  number: number;
  name: string;
  startDate: string;
  endDate: string;
  focus: string;
}

export interface Spec {
  text: string;
  owner?: string;
}

export interface Feature {
  id: string;
  title: string;
  team: string;
  owners: string[];
  status: FeatureStatus;
  sprint: number | null;
  effort: Effort;
  priority?: Priority;
  description?: string;
  specs?: (string | Spec)[];
}

export interface Person {
  github: string;
  name: string;
  teams: string[];
  role: string;
  /** @deprecated — use `teams` */
  team?: string;
}

export interface Team {
  name: string;
  color: string;
  repos: string[];
}

export interface OrgSettings {
  teams: Team[];
}

// Extended issue info with repo context
export interface IssueWithRepo extends IssueInfo {
  repo: string;
}

// Metric types for Team/Individual tabs
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
