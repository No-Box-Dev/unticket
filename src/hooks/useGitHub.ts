import { useQuery } from "@tanstack/react-query";
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
    queryFn: () => fetchRepos(selectedOrg!),
    enabled: !!selectedOrg,
  });
}

export function useOpenPRs(repos: string[]) {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["prs", selectedOrg, repos],
    queryFn: async () => {
      if (!selectedOrg) return [];
      const results = await Promise.all(
        repos.map((repo) => fetchOpenPRs(selectedOrg, repo)),
      );
      return results
        .flat()
        .sort(
          (a, b) =>
            new Date(b.updated_at).getTime() -
            new Date(a.updated_at).getTime(),
        );
    },
    enabled: !!selectedOrg && repos.length > 0,
  });
}

export function useOpenIssues(repos: string[]) {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["issues", selectedOrg, repos],
    queryFn: async () => {
      if (!selectedOrg) return [];
      const results = await Promise.all(
        repos.map((repo) => fetchOpenIssues(selectedOrg, repo)),
      );
      return results
        .flat()
        .sort(
          (a, b) =>
            new Date(b.updated_at).getTime() -
            new Date(a.updated_at).getTime(),
        );
    },
    enabled: !!selectedOrg && repos.length > 0,
  });
}

export function useMilestones(repos: string[]) {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["milestones", selectedOrg, repos],
    queryFn: async () => {
      if (!selectedOrg) return [];
      const results = await Promise.all(
        repos.map(async (repo) => {
          const milestones = await fetchMilestones(selectedOrg, repo);
          return milestones.map((m) => ({ ...m, repo }));
        }),
      );
      return results.flat();
    },
    enabled: !!selectedOrg && repos.length > 0,
  });
}

export function useActivity(repos: string[]) {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["activity", selectedOrg, repos],
    queryFn: async () => {
      if (!selectedOrg) return [];
      const results = await Promise.all(
        repos.map(async (repo) => {
          const commits = await fetchRepoActivity(selectedOrg, repo);
          return commits.map((c) => ({ ...c, repo }));
        }),
      );
      return results
        .flat()
        .sort(
          (a, b) =>
            new Date(b.commit.author?.date ?? 0).getTime() -
            new Date(a.commit.author?.date ?? 0).getTime(),
        );
    },
    enabled: !!selectedOrg && repos.length > 0,
  });
}

export function useClosedIssues(repos: string[], since?: string) {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["closedIssues", selectedOrg, repos, since],
    queryFn: async () => {
      if (!selectedOrg) return [];
      const results = await Promise.all(
        repos.map(async (repo) => {
          const issues = await fetchClosedIssues(selectedOrg, repo, since);
          return issues.map((i) => ({ ...i, repo }));
        }),
      );
      return results
        .flat()
        .sort(
          (a, b) =>
            new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
        );
    },
    enabled: !!selectedOrg && repos.length > 0,
  });
}

export function useMergedPRs(repos: string[], since?: string) {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["mergedPRs", selectedOrg, repos, since],
    queryFn: async () => {
      if (!selectedOrg) return [];
      const results = await Promise.all(
        repos.map(async (repo) => {
          const prs = await fetchMergedPRs(selectedOrg, repo, since);
          return prs.map((pr) => ({ ...pr, repo }));
        }),
      );
      return results
        .flat()
        .sort(
          (a, b) =>
            new Date(b.merged_at!).getTime() - new Date(a.merged_at!).getTime(),
        );
    },
    enabled: !!selectedOrg && repos.length > 0,
  });
}

export function useAllIssues(repos: string[], since?: string) {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["allIssues", selectedOrg, repos, since],
    queryFn: async () => {
      if (!selectedOrg) return [];
      const results = await Promise.all(
        repos.map(async (repo) => {
          const issues = await fetchAllIssues(selectedOrg, repo, since);
          return issues.map((i) => ({ ...i, repo }));
        }),
      );
      return results.flat();
    },
    enabled: !!selectedOrg && repos.length > 0,
  });
}

export function useOrgMembers() {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["orgMembers", selectedOrg],
    queryFn: () => fetchOrgMembers(selectedOrg!),
    enabled: !!selectedOrg,
  });
}
