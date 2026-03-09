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
  fetchMilestones,
  fetchRepoActivity,
  fetchOrgMembers,
  fetchSyncStatus,
  triggerSync,
  fetchPaginatedIssues,
  fetchIssueLabels,
  updateIssueAssignees,
  fetchUserOrgRole,
  fetchRateLimit,
} from "@/lib/github";
import type { RateLimitInfo } from "@/lib/github";
import type { IssueQueryParams } from "@/lib/github";
import { useAuth } from "@/lib/auth";

export function useOrgs() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["orgs"],
    queryFn: fetchOrgs,
    enabled: !!user,
  });
}

export function useRepos() {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["repos", selectedOrg],
    queryFn: fetchRepos,
    enabled: !!selectedOrg,
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

export function useMilestones(repos: string[]) {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["milestones", selectedOrg, repos],
    queryFn: fetchMilestones,
    enabled: !!selectedOrg && repos.length > 0,
  });
}

export function useActivity(repos: string[]) {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["activity", selectedOrg, repos],
    queryFn: fetchRepoActivity,
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

export function useUserOrgRole() {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["userOrgRole", selectedOrg],
    queryFn: () => fetchUserOrgRole(selectedOrg!),
    enabled: !!selectedOrg,
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useIsAdmin(): boolean {
  const { data: role } = useUserOrgRole();
  return role === "admin";
}

export function useOrgMembers() {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["orgMembers", selectedOrg],
    queryFn: fetchOrgMembers,
    enabled: !!selectedOrg,
  });
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

export function useIssueLabels() {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["issues", selectedOrg, "labels"],
    queryFn: fetchIssueLabels,
    enabled: !!selectedOrg,
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
      qc.setQueriesData<any>({ queryKey: ["issues", selectedOrg] }, (old: any) => {
        if (!old?.data) return old;
        return {
          ...old,
          data: old.data.map((issue: any) =>
            issue.repo === repo && issue.number === issueNumber
              ? { ...issue, assignees: assignees.map((login) => ({ login, avatar_url: issue.assignees?.find((a: any) => a.login === login)?.avatar_url ?? "" })) }
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
      qc.invalidateQueries({ queryKey: ["orgMembers", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["features", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["syncStatus", selectedOrg] });
    },
  });
}
