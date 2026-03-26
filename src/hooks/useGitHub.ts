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
  fetchOrgMembers,
  fetchSyncStatus,
  triggerSync,
  fetchPaginatedIssues,
  fetchIssueLabels,
  updateIssueAssignees,
  fetchUserOrgRole,
  fetchRateLimit,
  parseFeatureFromBranch,
  fetchLinkedPRs,
  linkPR,
  unlinkPR,
  updateIssueState,
} from "@/lib/github";
import type { RateLimitInfo } from "@/lib/github";
import type { IssueQueryParams } from "@/lib/github";
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

export function useRepos() {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["repos", selectedOrg],
    queryFn: fetchRepos,
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

export function useMilestones(repos: string[]) {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["milestones", selectedOrg, repos],
    queryFn: fetchMilestones,
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
      qc.invalidateQueries({ queryKey: ["prLinks", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["prsForFeature", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["syncStatus", selectedOrg] });
    },
  });
}

/** Linked PRs for D1 cache — returns source info for each link. */
export function useLinkedPRs(featureId: number) {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["prLinks", selectedOrg, featureId],
    queryFn: () => fetchLinkedPRs(featureId),
    enabled: !!selectedOrg && featureId > 0,
    staleTime: 3 * 60 * 1000,
  });
}

/** PRs linked to a feature — merges branch-detected + explicit links, deduped by repo+number. */
export function usePRsForFeature(featureId: number) {
  const { selectedOrg } = useAuth();
  const { data: prLinks } = useLinkedPRs(featureId);

  return useQuery({
    // Include prLinks in the key so the query re-runs when links change
    queryKey: ["prsForFeature", selectedOrg, featureId, prLinks ?? []],
    queryFn: async () => {
      const all = await fetchAllPRs();
      // Branch-detected PRs
      const branchPRs = all.filter((pr) => parseFeatureFromBranch(pr.head.ref) === featureId);
      // Explicitly linked PRs from D1
      const explicitPRs = (prLinks ?? [])
        .map((link) => all.find((pr) => pr.repo === link.pr_repo && pr.number === link.pr_number))
        .filter(Boolean) as typeof all;

      // Deduplicate by repo+number
      const seen = new Set<string>();
      const result: (typeof all[0] & { linkSource?: string })[] = [];

      for (const pr of branchPRs) {
        const key = `${pr.repo}:${pr.number}`;
        if (!seen.has(key)) {
          seen.add(key);
          result.push({ ...pr, linkSource: "branch" });
        }
      }
      for (const pr of explicitPRs) {
        const key = `${pr.repo}:${pr.number}`;
        if (!seen.has(key)) {
          seen.add(key);
          const link = prLinks?.find((l) => l.pr_repo === pr.repo && l.pr_number === pr.number);
          result.push({ ...pr, linkSource: link?.source ?? "manual" });
        }
      }

      return result;
    },
    enabled: !!selectedOrg && featureId > 0 && prLinks !== undefined,
    staleTime: 3 * 60 * 1000,
  });
}

/** Link a PR to a feature. */
export function useLinkPR() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ featureId, prRepo, prNumber }: { featureId: number; prRepo: string; prNumber: number }) =>
      linkPR(featureId, prRepo, prNumber),
    onSuccess: (_data, { featureId }) => {
      qc.invalidateQueries({ queryKey: ["prLinks", selectedOrg, featureId] });
      qc.invalidateQueries({ queryKey: ["prsForFeature", selectedOrg, featureId] });
    },
  });
}

/** Unlink a PR from a feature. */
export function useUnlinkPR() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ featureId, prRepo, prNumber }: { featureId: number; prRepo: string; prNumber: number }) =>
      unlinkPR(featureId, prRepo, prNumber),
    onSuccess: (_data, { featureId }) => {
      qc.invalidateQueries({ queryKey: ["prLinks", selectedOrg, featureId] });
      qc.invalidateQueries({ queryKey: ["prsForFeature", selectedOrg, featureId] });
    },
  });
}

/** Cross-repo issues assigned to the current user (from D1, excludes gitpulse repo). */
export function useAssignedIssues(login: string) {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["assignedIssues", selectedOrg, login],
    queryFn: async () => {
      const res = await fetchPaginatedIssues({ assignee: login, state: "all", pageSize: 200 });
      // Exclude issues from the gitpulse repo (those are todos/features/sprint tasks)
      return (res.data as any[]).filter((i) => i.repo !== "gitpulse" && i.repo !== ".gitpulse");
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
        .filter((pr: any) =>
          !pr.draft &&
          pr.requested_reviewers?.some((r: any) => r.login === login),
        )
        .map((pr: any) => ({
          repo: pr.repo,
          number: pr.number,
          title: pr.title,
          state: pr.state,
          draft: pr.draft,
          merged_at: pr.merged_at,
          html_url: pr.html_url,
          author: pr.user?.login ?? null,
          created_at: pr.created_at,
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
