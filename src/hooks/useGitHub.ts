import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import {
  fetchOrgs,
  fetchRepos,
  fetchOpenPRs,
  fetchOpenIssues,
  fetchClosedIssues,
  fetchMergedPRs,
  fetchAllPRs,
  fetchAllIssues,
  fetchOrgMembers,
  fetchTeams,
  fetchSyncStatus,
  triggerSync,
  triggerFeatureSync,
  fetchPaginatedIssues,
  fetchPaginatedPrs,
  fetchIssueLabels,
  fetchIssueStats,
  fetchPRStats,
  updateIssueAssignees,
  fetchMe,
  fetchRateLimit,
  updateIssueState,
  fetchEngineerStats,
  fetchEngineerActivity,
  fetchIssueDetail,
  fetchPrDetail,
  fetchIssueBody,
  fetchPrBody,
} from "@/lib/github";
import type { RateLimitInfo, IssueQueryParams, PrQueryParams, PaginatedResponse, IssueStats, PRStats, EngineerStats, EngineerActivity } from "@/lib/github";
import { useAuth } from "@/lib/auth";
import { useMemo } from "react";
import { useSettings } from "@/hooks/useConfigRepo";

export function useOrgs() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["orgs"],
    queryFn: fetchOrgs,
    enabled: !!user,
    staleTime: 10 * 60 * 1000,
  });
}

export function useRepos(opts?: { includeAll?: boolean }) {
  const { selectedOrg } = useAuth();
  const includeAll = opts?.includeAll ?? false;
  return useQuery({
    queryKey: ["repos", selectedOrg, includeAll],
    queryFn: () => fetchRepos({ includeAll }),
    enabled: !!selectedOrg,
    staleTime: 10 * 60 * 1000,
  });
}

export function useOpenPRs(repos: string[]) {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["prs", selectedOrg, repos],
    queryFn: fetchOpenPRs,
    enabled: !!selectedOrg && repos.length > 0,
  });
}

export function useOpenIssues(repos: string[]) {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["issues", selectedOrg, repos],
    queryFn: fetchOpenIssues,
    enabled: !!selectedOrg && repos.length > 0,
  });
}

export function useClosedIssues(repos: string[], since?: string) {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["closedIssues", selectedOrg, repos, since],
    queryFn: () => fetchClosedIssues(since),
    enabled: !!selectedOrg && repos.length > 0,
  });
}

export function useMergedPRs(repos: string[], since?: string) {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["mergedPRs", selectedOrg, repos, since],
    queryFn: () => fetchMergedPRs(since),
    enabled: !!selectedOrg && repos.length > 0,
  });
}

export function useAllPRs(repos: string[], since?: string) {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["allPRs", selectedOrg, repos, since],
    queryFn: () => fetchAllPRs(since),
    enabled: !!selectedOrg && repos.length > 0,
  });
}

export function useAllIssues(repos: string[], since?: string) {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["allIssues", selectedOrg, repos, since],
    queryFn: () => fetchAllIssues(since),
    enabled: !!selectedOrg && repos.length > 0,
  });
}

export function useMe() {
  const { selectedOrg, user } = useAuth();
  return useQuery({
    queryKey: ["me", selectedOrg],
    queryFn: fetchMe,
    enabled: !!selectedOrg && !!user,
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useIsAdmin(): boolean {
  const { data } = useMe();
  return Boolean(data?.isAdmin);
}

export function useOrgMembers() {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["orgMembers", selectedOrg],
    queryFn: fetchOrgMembers,
    enabled: !!selectedOrg,
    staleTime: 10 * 60 * 1000,
  });
}

export function useGhTeamMemberships() {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["ghTeams", selectedOrg],
    queryFn: fetchTeams,
    enabled: !!selectedOrg,
    staleTime: 10 * 60 * 1000,
  });
}

/** Org members filtered by excludedMembers setting — use this for display. */
export function useActiveMembers() {
  const { data: orgMembers, isLoading } = useOrgMembers();
  const { data: settings } = useSettings();
  const excludedMembers = settings?.excludedMembers;
  const data = useMemo(() => {
    if (!orgMembers) return undefined;
    const excluded = new Set(excludedMembers ?? []);
    if (excluded.size === 0) return orgMembers;
    return orgMembers.filter((m: { login: string }) => !excluded.has(m.login));
  }, [orgMembers, excludedMembers]);
  return { data, isLoading };
}

// ---------- Paginated issues hooks ----------

export function usePaginatedIssues(params: IssueQueryParams, enabled = true) {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["issues", selectedOrg, params],
    queryFn: () => fetchPaginatedIssues(params),
    enabled: !!selectedOrg && enabled,
    placeholderData: keepPreviousData,
  });
}

export function usePaginatedPrs(params: PrQueryParams, enabled = true) {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["prs", selectedOrg, params],
    queryFn: () => fetchPaginatedPrs(params),
    enabled: !!selectedOrg && enabled,
    placeholderData: keepPreviousData,
  });
}

export function useIssueDetail(repo: string | undefined, number: number | undefined) {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["issueDetail", selectedOrg, repo, number],
    queryFn: () => fetchIssueDetail(repo!, number!),
    enabled: !!selectedOrg && !!repo && !!number,
    staleTime: 30 * 1000,
  });
}

export function usePrDetail(repo: string | undefined, number: number | undefined) {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["prDetail", selectedOrg, repo, number],
    queryFn: () => fetchPrDetail(repo!, number!),
    enabled: !!selectedOrg && !!repo && !!number,
    staleTime: 30 * 1000,
  });
}

export function useIssueBody(repo: string | undefined, number: number | undefined) {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["issueBody", selectedOrg, repo, number],
    queryFn: () => fetchIssueBody(selectedOrg!, repo!, number!),
    enabled: !!selectedOrg && !!repo && !!number,
    staleTime: 60 * 1000,
    retry: false,
  });
}

export function usePrBody(repo: string | undefined, number: number | undefined) {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["prBody", selectedOrg, repo, number],
    queryFn: () => fetchPrBody(selectedOrg!, repo!, number!),
    enabled: !!selectedOrg && !!repo && !!number,
    staleTime: 60 * 1000,
    retry: false,
  });
}

export function useIssueLabels() {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["issues", selectedOrg, "labels"],
    queryFn: fetchIssueLabels,
    enabled: !!selectedOrg,
  });
}

export function useIssueStats(repos?: string[]) {
  const { selectedOrg } = useAuth();
  return useQuery<IssueStats>({
    queryKey: ["issues", selectedOrg, "stats", repos],
    queryFn: () => fetchIssueStats(repos),
    enabled: !!selectedOrg,
    staleTime: 2 * 60 * 1000,
  });
}

export function usePRStats() {
  const { selectedOrg } = useAuth();
  return useQuery<PRStats>({
    queryKey: ["prs", selectedOrg, "stats"],
    queryFn: fetchPRStats,
    enabled: !!selectedOrg,
    staleTime: 2 * 60 * 1000,
  });
}

/** Per-member counts (open PRs, reviewing, assigned issues, lifetime/recent PRs, issues closed). */
export function useEngineerStats() {
  const { selectedOrg } = useAuth();
  return useQuery<EngineerStats>({
    queryKey: ["engineerStats", selectedOrg],
    queryFn: fetchEngineerStats,
    enabled: !!selectedOrg,
    staleTime: 2 * 60 * 1000,
  });
}

/** Daily PRs-opened + PRs-reviewed for one engineer, for a given month (activity table). */
export function useEngineerActivity(login: string, month?: string) {
  const { selectedOrg } = useAuth();
  return useQuery<EngineerActivity>({
    queryKey: ["engineerActivity", selectedOrg, login, month ?? "current"],
    queryFn: () => fetchEngineerActivity(login, month),
    enabled: !!selectedOrg && !!login,
    staleTime: 5 * 60 * 1000,
  });
}

// ---------- Issue assignee mutation ----------

export function useUpdateIssueAssignees() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ repo, issueNumber, assignees }: { repo: string; issueNumber: number; assignees: string[] }) =>
      updateIssueAssignees(repo, issueNumber, assignees),
    onMutate: async ({ repo, issueNumber, assignees }) => {
      // Optimistically update all issue queries
      await qc.cancelQueries({ queryKey: ["issues", selectedOrg] });
      type CachedIssue = { repo: string; number: number; assignees: { login: string; avatar_url: string }[] };
      qc.setQueriesData<PaginatedResponse<CachedIssue>>({ queryKey: ["issues", selectedOrg] }, (old) => {
        if (!old?.data) return old;
        return {
          ...old,
          data: old.data.map((issue) =>
            issue.repo === repo && issue.number === issueNumber
              ? { ...issue, assignees: assignees.map((login) => ({ login, avatar_url: issue.assignees?.find((a) => a.login === login)?.avatar_url ?? "" })) }
              : issue,
          ),
        };
      });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["issues", selectedOrg] });
    },
  });
}

// ---------- Rate limit ----------

export function useRateLimit() {
  const { selectedOrg } = useAuth();
  return useQuery<RateLimitInfo>({
    queryKey: ["rateLimit", selectedOrg],
    queryFn: fetchRateLimit,
    enabled: !!selectedOrg,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
}

// ---------- Sync hooks ----------

export function useSyncStatus() {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["syncStatus", selectedOrg],
    queryFn: fetchSyncStatus,
    enabled: !!selectedOrg,
    staleTime: 10 * 60 * 1000,
  });
}

export function useTriggerFeatureSync() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: triggerFeatureSync,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["features", selectedOrg] });
    },
  });
}

export function useTriggerSync() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: triggerSync,
    onSuccess: () => {
      // Invalidate all cached data after sync
      qc.invalidateQueries({ queryKey: ["repos", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["prs", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["issues", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["closedIssues", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["mergedPRs", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["allPRs", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["allIssues", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["engineerStats", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["orgMembers", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["features", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["syncStatus", selectedOrg] });
    },
  });
}

/** Cross-repo issues assigned to the current user (from D1, excludes unticket repo). */
export function useAssignedIssues(login: string) {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["assignedIssues", selectedOrg, login],
    queryFn: async () => {
      const res = await fetchPaginatedIssues({ assignee: login, state: "all", pageSize: 200 });
      // Exclude issues from the unticket repo (those are features)
      return res.data.filter((i) => i.repo !== "unticket" && i.repo !== ".unticket");
    },
    enabled: !!selectedOrg && !!login,
    staleTime: 2 * 60 * 1000,
  });
}

/** Open PRs where the user is a requested reviewer. */
export function useReviewPRs(login: string) {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["reviewPRs", selectedOrg, login],
    queryFn: async () => {
      const prs = await fetchOpenPRs();
      return prs
        .filter((pr) =>
          !pr.draft &&
          pr.requested_reviewers?.some((r) => r.login === login),
        )
        .map((pr) => ({
          repo: pr.repo,
          number: pr.number,
          title: pr.title,
          state: pr.state,
          draft: pr.draft,
          merged_at: pr.merged_at,
          html_url: pr.html_url,
          author: pr.user?.login ?? null,
          created_at: pr.created_at,
          updated_at: pr.updated_at,
        }));
    },
    enabled: !!selectedOrg && !!login,
    staleTime: 2 * 60 * 1000,
  });
}

/** Close or reopen a cross-repo issue. */
export function useUpdateIssueState() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { repo: string; issueNumber: number; state: "open" | "closed" }) =>
      updateIssueState(args.repo, args.issueNumber, args.state),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assignedIssues", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["issues", selectedOrg] });
    },
  });
}
