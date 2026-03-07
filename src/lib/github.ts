import { Octokit } from "octokit";
import { apiGet, apiPost, ApiError } from "./api";

// ---------- Auth (still uses Octokit directly) ----------

let octokitInstance: Octokit | null = null;

export function getOctokit(): Octokit {
  if (!octokitInstance) {
    const token = localStorage.getItem("gp_token");
    if (!token) throw new Error("Not authenticated");
    octokitInstance = new Octokit({
      auth: token,
      throttle: {
        onRateLimit: (retryAfter: number, options: any, _octokit: any, retryCount: number) => {
          console.warn(
            `[GitPulse] Rate limit hit for ${options.url}, retry #${retryCount}, resets in ${retryAfter}s`,
          );
          return retryCount < 1;
        },
        onSecondaryRateLimit: (retryAfter: number, options: any) => {
          console.warn(
            `[GitPulse] Secondary rate limit for ${options.url}, resets in ${retryAfter}s`,
          );
          return false;
        },
      },
      retry: { doNotRetry: [400, 401, 403, 404, 422, 451] },
    });
  }
  return octokitInstance;
}

export function resetOctokit() {
  octokitInstance = null;
}

/** Wraps Octokit errors into ApiError so the retry logic can identify them. */
function wrapOctokitError(err: unknown): never {
  if (err instanceof ApiError) throw err;
  if (err instanceof Error) {
    // Octokit includes status in the error object
    const status = (err as any).status as number | undefined;
    if (status === 401) {
      localStorage.removeItem("gp_token");
      localStorage.removeItem("n1_github_token");
      window.dispatchEvent(new CustomEvent("gp:force-logout"));
      throw new ApiError("Token expired or revoked", 401);
    }
    if (status === 403 || status === 429) {
      throw new ApiError(err.message || "Rate limit exceeded", status);
    }
    if (status) {
      throw new ApiError(err.message, status);
    }
  }
  throw err;
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number; // Unix timestamp
  used: number;
}

export async function fetchRateLimit(): Promise<RateLimitInfo> {
  const ok = getOctokit();
  const { data } = await ok.rest.rateLimit.get();
  const core = data.resources.core;
  return {
    limit: core.limit,
    remaining: core.remaining,
    reset: core.reset,
    used: core.used,
  };
}

export async function fetchUser() {
  try {
    const ok = getOctokit();
    const { data } = await ok.rest.users.getAuthenticated();
    return data;
  } catch (err) {
    throw wrapOctokitError(err);
  }
}

export async function fetchOrgs() {
  try {
    const ok = getOctokit();
    const { data } = await ok.rest.orgs.listForAuthenticatedUser();
    return data;
  } catch (err) {
    throw wrapOctokitError(err);
  }
}

export async function fetchUserOrgRole(org: string): Promise<"admin" | "member"> {
  try {
    const ok = getOctokit();
    const { data } = await ok.rest.orgs.getMembershipForAuthenticatedUser({ org });
    return data.role === "admin" ? "admin" : "member";
  } catch (err) {
    console.warn("[GitPulse] Failed to fetch org role, defaulting to member:", err);
    return "member";
  }
}

// ---------- Sync ----------

interface SyncResponse {
  done: boolean;
  cursor?: string;
  repos?: number;
  repoList?: string[];
  synced?: string;
  lastRepo?: string;
}

export async function triggerSync() {
  // Phase 1: init — get repo list
  const init = await apiPost<SyncResponse>("/api/sync");

  if (init.done) {
    return { ok: true, synced: { repos: 0, prs: 0, issues: 0, members: 0 } };
  }

  // Phase 2: sync one repo at a time via cursor
  let cursor = init.cursor;
  const maxIterations = (init.repos ?? 0) + 5;
  let iterations = 0;
  while (cursor && iterations < maxIterations) {
    const res = await apiPost<SyncResponse>(`/api/sync?cursor=${encodeURIComponent(cursor)}`);
    if (res.done) break;
    cursor = res.cursor;
    iterations++;
  }

  return { ok: true, synced: { repos: init.repos ?? 0, prs: 0, issues: 0, members: 0 } };
}

export interface SyncProgress {
  phase: "init" | "syncing" | "done" | "error";
  repo?: string;
  synced: number;
  total: number;
  error?: string;
}

export async function triggerSyncWithProgress(
  onProgress: (status: SyncProgress) => void,
) {
  try {
    onProgress({ phase: "init", synced: 0, total: 0 });

    const init = await apiPost<SyncResponse>("/api/sync");

    if (init.done) {
      onProgress({ phase: "done", synced: 0, total: 0 });
      return;
    }

    const total = init.repos ?? 0;
    let cursor = init.cursor;
    const maxIterations = total + 5;
    let iterations = 0;
    let synced = 0;

    while (cursor && iterations < maxIterations) {
      onProgress({ phase: "syncing", repo: cursor, synced, total });
      const res = await apiPost<SyncResponse>(
        `/api/sync?cursor=${encodeURIComponent(cursor)}`,
      );
      synced++;
      if (res.done) break;
      cursor = res.cursor;
      iterations++;
    }

    onProgress({ phase: "done", synced, total });
  } catch (err) {
    onProgress({
      phase: "error",
      synced: 0,
      total: 0,
      error: err instanceof Error ? err.message : "Sync failed",
    });
  }
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

export async function updateIssueAssignees(
  repo: string,
  issueNumber: number,
  assignees: string[],
): Promise<{ assignees: { login: string; avatar_url: string }[] }> {
  return apiPost("/api/assign", { repo, issue_number: issueNumber, assignees });
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
