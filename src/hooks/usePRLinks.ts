import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import {
  fetchLinkedPRs,
  fetchLinkedFeatures,
  linkPR,
  unlinkPR,
} from "@/lib/pr-links";

export function useLinkedPRs(featureNumber: number | undefined) {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["linkedPRs", selectedOrg, featureNumber],
    queryFn: () => fetchLinkedPRs(featureNumber!),
    enabled: !!selectedOrg && !!featureNumber,
    staleTime: 30_000,
  });
}

export function useLinkedFeatures(
  repo: string | undefined,
  number: number | undefined,
) {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["linkedFeatures", selectedOrg, repo, number],
    queryFn: () => fetchLinkedFeatures(repo!, number!),
    enabled: !!selectedOrg && !!repo && !!number,
    staleTime: 30_000,
  });
}

export function useLinkPR() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      featureNumber,
      prRepo,
      prNumber,
    }: {
      featureNumber: number;
      prRepo: string;
      prNumber: number;
    }) => linkPR(featureNumber, prRepo, prNumber),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["linkedPRs", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["linkedFeatures", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["features", selectedOrg] });
    },
  });
}

export function useUnlinkPR() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      featureNumber,
      prRepo,
      prNumber,
    }: {
      featureNumber: number;
      prRepo: string;
      prNumber: number;
    }) => unlinkPR(featureNumber, prRepo, prNumber),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["linkedPRs", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["linkedFeatures", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["features", selectedOrg] });
    },
  });
}
