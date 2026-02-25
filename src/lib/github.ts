import { Octokit } from "octokit";
import { apiGet, apiPost } from "./api";

// ---------- Auth (still uses Octokit directly) ----------

let octokitInstance: Octokit | null = null;

export function getOctokit(): Octokit {
  if (!octokitInstance) {
    const token = localStorage.getItem("gp_token");
    if (!token) throw new Error("Not authenticated");
    octokitInstance = new Octokit({
      auth: token,
      throttle: { onRateLimit: () => false, onSecondaryRateLimit: () => false },
      retry: { doNotRetry: [400, 401, 403, 404, 422, 451] },
    });
  }
  return octokitInstance;
}

export function resetOctokit() {
  octokitInstance = null;
}

export async function fetchUser() {
  const ok = getOctokit();
  const { data } = await ok.rest.users.getAuthenticated();
  return data;
}

export async function fetchOrgs() {
  const ok = getOctokit();
  const { data } = await ok.rest.orgs.listForAuthenticatedUser();
  return data;
}

// ---------- Sync ----------

export async function triggerSync() {
  return apiPost<{ ok: boolean; synced: { repos: number; prs: number; issues: number; members: number } }>("/api/sync");
}

export async function fetchSyncStatus() {
  return apiGet<{ isStale: boolean; lastSync: string | null }>("/api/sync");
}

// ---------- DB-backed API types ----------

interface ApiRepo {
  name: string;
  language: string | null;
  pushed_at: string | null;
}

interface ApiPR {
  id: number;
  repo: string;
  number: number;
  title: string;
  state: string;
  author: string | null;
  author_avatar: string | null;
  draft: boolean;
  head_ref: string | null;
  base_ref: string | null;
  merged_at: string | null;
  created_at: string;
  updated_at: string;
  html_url: string;
  requested_reviewers: { login: string }[];
  labels: { name: string; color: string }[];
}

interface ApiIssue {
  id: number;
  repo: string;
  number: number;
  title: string;
  state: string;
  author: string | null;
  author_avatar: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  html_url: string;
  assignees: { login: string; avatar_url?: string }[];
  labels: { name: string; color: string }[];
  milestone_title: string | null;
}

interface ApiMember {
  login: string;
  avatar_url: string | null;
}

// ---------- Transform API → Octokit-compatible shapes ----------

function transformPR(pr: ApiPR) {
  return {
    id: pr.id,
    number: pr.number,
    title: pr.title,
    state: pr.state,
    created_at: pr.created_at,
    updated_at: pr.updated_at,
    merged_at: pr.merged_at,
    draft: pr.draft,
    user: pr.author ? { login: pr.author, avatar_url: pr.author_avatar ?? "" } : null,
    head: { ref: pr.head_ref ?? "", repo: { name: pr.repo, full_name: pr.repo } },
    base: { ref: pr.base_ref ?? "" },
    html_url: pr.html_url,
    requested_reviewers: pr.requested_reviewers,
    labels: pr.labels,
    repo: pr.repo,
  };
}

function transformIssue(issue: ApiIssue) {
  return {
    id: issue.id,
    number: issue.number,
    title: issue.title,
    state: issue.state,
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    closed_at: issue.closed_at,
    user: issue.author ? { login: issue.author, avatar_url: issue.author_avatar ?? "" } : null,
    assignees: issue.assignees.map((a) => ({ login: a.login, avatar_url: a.avatar_url ?? "" })),
    labels: issue.labels,
    milestone: issue.milestone_title ? { title: issue.milestone_title } : null,
    html_url: issue.html_url,
    repo: issue.repo,
  };
}

// ---------- Data fetchers (call our API) ----------

export async function fetchRepos() {
  const repos = await apiGet<ApiRepo[]>("/api/repos");
  return repos.map((r) => ({
    id: 0,
    name: r.name,
    full_name: r.name,
    description: null,
    open_issues_count: 0,
    pushed_at: r.pushed_at,
    language: r.language,
    visibility: "private",
  }));
}

export async function fetchOpenPRs() {
  const prs = await apiGet<ApiPR[]>("/api/prs?state=open");
  return prs.map(transformPR);
}

export async function fetchMergedPRs(since?: string) {
  const params = new URLSearchParams({ state: "merged" });
  if (since) params.set("since", since);
  const prs = await apiGet<ApiPR[]>(`/api/prs?${params}`);
  return prs.map(transformPR);
}

export async function fetchAllPRs(since?: string) {
  const params = new URLSearchParams({ state: "all" });
  if (since) params.set("since", since);
  const prs = await apiGet<ApiPR[]>(`/api/prs?${params}`);
  return prs.map(transformPR);
}

export async function fetchOpenIssues() {
  const res = await apiGet<{ data: ApiIssue[]; totalCount: number }>("/api/issues?state=open");
  return res.data.map(transformIssue);
}

export async function fetchClosedIssues(since?: string) {
  const params = new URLSearchParams({ state: "closed" });
  if (since) params.set("closed_since", since);
  const res = await apiGet<{ data: ApiIssue[]; totalCount: number }>(`/api/issues?${params}`);
  return res.data.map(transformIssue);
}

export async function fetchAllIssues(since?: string) {
  const params = new URLSearchParams({ state: "all" });
  if (since) params.set("since", since);
  const res = await apiGet<{ data: ApiIssue[]; totalCount: number }>(`/api/issues?${params}`);
  return res.data.map(transformIssue);
}

export async function fetchOrgMembers() {
  const members = await apiGet<ApiMember[]>("/api/members");
  return members.map((m) => ({
    login: m.login,
    avatar_url: m.avatar_url ?? "",
    id: 0,
    type: "User" as const,
  }));
}

// ---------- Paginated issues ----------

export interface PaginatedResponse<T> {
  data: T[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export interface IssueQueryParams {
  state?: "open" | "closed" | "all";
  page?: number;
  pageSize?: number;
  repos?: string[];
  label?: string;
  sort?: "updated_at" | "created_at" | "number" | "title" | "repo";
  sortDir?: "asc" | "desc";
  closedSince?: string;
}

export async function fetchPaginatedIssues(params: IssueQueryParams): Promise<PaginatedResponse<ReturnType<typeof transformIssue>>> {
  const qs = new URLSearchParams();
  if (params.state) qs.set("state", params.state);
  if (params.page) qs.set("page", String(params.page));
  if (params.pageSize) qs.set("page_size", String(params.pageSize));
  if (params.repos?.length) qs.set("repos", params.repos.join(","));
  if (params.label) qs.set("label", params.label);
  if (params.sort) qs.set("sort", params.sort);
  if (params.sortDir) qs.set("sort_dir", params.sortDir);
  if (params.closedSince) qs.set("closed_since", params.closedSince);

  const raw = await apiGet<{ data: ApiIssue[]; totalCount: number; page: number; pageSize: number }>(
    `/api/issues?${qs}`,
  );
  return {
    data: raw.data.map(transformIssue),
    totalCount: raw.totalCount,
    page: raw.page,
    pageSize: raw.pageSize,
  };
}

export async function fetchIssueLabels(): Promise<{ name: string; color: string }[]> {
  return apiGet<{ name: string; color: string }[]>("/api/issues?meta=labels");
}

// ---------- Other ----------

export async function fetchMilestones(): Promise<{ id: number; title: string; due_on: string | null; state: string; repo: string }[]> {
  return [];
}

export interface CommitResult {
  sha: string;
  commit: {
    message: string;
    author: { name: string; date: string } | null;
  };
  repo: string;
}

export async function fetchRepoActivity(): Promise<CommitResult[]> {
  return [];
}

