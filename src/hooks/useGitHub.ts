import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchOrgs,
  fetchRepos,
  fetchOpenPRs,
  fetchOpenIssues,
  fetchClosedIssues,
  fetchMergedPRs,
  fetchAllIssues,
  fetchMilestones,
  fetchRepoActivity,
  fetchOrgMembers,
  fetchSyncStatus,
  triggerSync,
} from "@/lib/github";
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

export function useAllIssues(repos: string[], since?: string) {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["allIssues", selectedOrg, repos, since],
    queryFn: () => fetchAllIssues(since),
    enabled: !!selectedOrg && repos.length > 0,
  });
}

export function useOrgMembers() {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["orgMembers", selectedOrg],
    queryFn: fetchOrgMembers,
    enabled: !!selectedOrg,
  });
}

// ---------- Sync hooks ----------

export function useSyncStatus() {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["syncStatus", selectedOrg],
    queryFn: fetchSyncStatus,
    enabled: !!selectedOrg,
    refetchInterval: 60_000,
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
      qc.invalidateQueries({ queryKey: ["allIssues", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["orgMembers", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["syncStatus", selectedOrg] });
    },
  });
}
