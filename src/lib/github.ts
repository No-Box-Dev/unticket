import { Octokit } from "@octokit/rest";
import { paginateRest } from "@octokit/plugin-paginate-rest";
import { throttling } from "@octokit/plugin-throttling";
import { retry } from "@octokit/plugin-retry";
import { apiGet, apiPost, apiFetch, ApiError, broadcastError } from "./api";

// ---------- Auth (still uses Octokit directly) ----------

const CustomOctokit = Octokit.plugin(paginateRest, throttling, retry);

type CustomOctokitInstance = InstanceType<typeof CustomOctokit>;

let octokitInstance: CustomOctokitInstance | null = null;

export function getOctokit(): CustomOctokitInstance {
  if (!octokitInstance) {
    const token = localStorage.getItem("gp_token");
    if (!token) throw new Error("Not authenticated");
    octokitInstance = new CustomOctokit({
      auth: token,
      throttle: {
        onRateLimit: (retryAfter: number, options: any, _octokit: any, retryCount: number) => {
          console.warn(
            `[unticket.ai] Rate limit hit for ${options.url}, retry #${retryCount}, resets in ${retryAfter}s`,
          );
          return retryCount < 1;
        },
        onSecondaryRateLimit: (retryAfter: number, options: any) => {
          console.warn(
            `[unticket.ai] Secondary rate limit for ${options.url}, resets in ${retryAfter}s`,
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
      broadcastError("Token expired or revoked", 401);
      throw new ApiError("Token expired or revoked", 401);
    }
    if (status === 403 || status === 429) {
      broadcastError(err.message || "Rate limit exceeded", status);
      throw new ApiError(err.message || "Rate limit exceeded", status);
    }
    if (status) {
      broadcastError(err.message, status);
      throw new ApiError(err.message, status);
    }
    broadcastError(err.message, 0);
    throw new ApiError(err.message, 0);
  }
  broadcastError(String(err), 0);
  throw new ApiError(String(err), 0);
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
    console.warn("[unticket.ai] Failed to fetch org role, defaulting to member:", err);
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

  if (iterations >= maxIterations && cursor) {
    console.error(`[gitpulse] Sync exceeded max iterations (${maxIterations}). Remaining cursor: ${cursor}`);
    // Return partial success with remaining cursor so callers can resume
    return { ok: false, synced: { repos: init.repos ?? 0, prs: 0, issues: 0, members: 0 }, remainingCursor: cursor };
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
  force = false,
  signal?: AbortSignal,
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
    const forceParam = force ? "&force=true" : "";

    while (cursor && iterations < maxIterations) {
      if (signal?.aborted) return;
      onProgress({ phase: "syncing", repo: cursor, synced, total });
      const res = await apiPost<SyncResponse>(
        `/api/sync?cursor=${encodeURIComponent(cursor)}${forceParam}`,
      );
      synced++;
      if (res.done) break;
      cursor = res.cursor;
      iterations++;
    }

    if (!signal?.aborted) {
      onProgress({ phase: "done", synced, total });
    }
  } catch (err) {
    if (signal?.aborted) return;
    const msg = err instanceof Error ? err.message : "Sync failed";
    // ApiError already broadcasts; for other errors, broadcast manually
    if (!(err instanceof ApiError)) {
      broadcastError(msg);
    }
    onProgress({
      phase: "error",
      synced: 0,
      total: 0,
      error: msg,
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
  closed_by: string | null;
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
    closed_by: issue.closed_by,
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
  const prs = await apiGet<ApiPR[]>("/api/prs?state=open&page_size=500");
  return prs.map(transformPR);
}

export async function fetchMergedPRs(since?: string) {
  const params = new URLSearchParams({ state: "merged", page_size: "500" });
  if (since) params.set("since", since);
  const prs = await apiGet<ApiPR[]>(`/api/prs?${params}`);
  return prs.map(transformPR);
}

export async function fetchAllPRs(since?: string) {
  const params = new URLSearchParams({ state: "all", page_size: "500" });
  if (since) params.set("since", since);
  const prs = await apiGet<ApiPR[]>(`/api/prs?${params}`);
  return prs.map(transformPR);
}

export async function fetchOpenIssues() {
  const res = await apiGet<{ data: ApiIssue[]; totalCount: number }>("/api/issues?state=open");
  return res.data.map(transformIssue);
}

export async function fetchClosedIssues(since?: string) {
  const params = new URLSearchParams({ state: "closed", page_size: "5000" });
  if (since) params.set("closed_since", since);
  const res = await apiGet<{ data: ApiIssue[]; totalCount: number }>(`/api/issues?${params}`);
  return res.data.map(transformIssue);
}

export async function fetchAllIssues(since?: string) {
  const params = new URLSearchParams({ state: "all", page_size: "5000" });
  if (since) params.set("since", since);
  const res = await apiGet<{ data: ApiIssue[]; totalCount: number }>(`/api/issues?${params}`);
  return res.data.map(transformIssue);
}

/**
 * Extract a feature number from a branch name.
 * Matches patterns like: feat/42-description, feature/42, fix/42-bug, 42-some-branch
 */
/** NOTE: Duplicated in functions/lib/feature-metadata.js — keep both in sync. */
export function parseFeatureFromBranch(ref: string): number | null {
  const match = ref.match(/^(?:feat|feature|fix|chore|refactor)\/(\d+)(?:-|$)/);
  if (match) return Number(match[1]);
  // Also match plain "42-description" branches
  const plain = ref.match(/^(\d+)-/);
  if (plain) return Number(plain[1]);
  return null;
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
  assignee?: string;
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
  if (params.assignee) qs.set("assignee", params.assignee);
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

// ---------- PR-Feature Links ----------

export interface PRLink {
  pr_repo: string;
  pr_number: number;
  source: string;
  created_at: string;
}

export async function fetchLinkedPRs(featureNumber: number): Promise<PRLink[]> {
  return apiGet<PRLink[]>(`/api/pr-links?feature=${featureNumber}`);
}

export async function linkPR(featureNumber: number, prRepo: string, prNumber: number): Promise<void> {
  await apiPost("/api/pr-links", { feature_number: featureNumber, pr_repo: prRepo, pr_number: prNumber });
}

export async function unlinkPR(featureNumber: number, prRepo: string, prNumber: number): Promise<void> {
  const res = await apiFetch(
    `/api/pr-links?feature=${featureNumber}&pr_repo=${encodeURIComponent(prRepo)}&pr_number=${prNumber}`,
    { method: "DELETE" },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError((body as { error?: string }).error ?? `API error: ${res.status}`, res.status);
  }
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
