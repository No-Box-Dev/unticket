import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import {
  fetchSprint,
  saveSprint,
  fetchFeatures,
  saveFeatures,
  fetchPeople,
  savePeople,
  fetchSettings,
  ensureConfigRepo,
} from "@/lib/config-repo";
import type { SprintConfig, Feature, Person } from "@/lib/types";

export function useConfigRepoExists() {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["configRepo", selectedOrg],
    queryFn: () => ensureConfigRepo(selectedOrg!),
    enabled: !!selectedOrg,
    staleTime: 5 * 60 * 1000,
  });
}

export function useSprint() {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["sprint", selectedOrg],
    queryFn: () => fetchSprint(selectedOrg!),
    enabled: !!selectedOrg,
  });
}

export function useFeatures() {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["features", selectedOrg],
    queryFn: () => fetchFeatures(selectedOrg!),
    enabled: !!selectedOrg,
  });
}

export function usePeople() {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["people", selectedOrg],
    queryFn: () => fetchPeople(selectedOrg!),
    enabled: !!selectedOrg,
  });
}

export function useSettings() {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["settings", selectedOrg],
    queryFn: () => fetchSettings(selectedOrg!),
    enabled: !!selectedOrg,
  });
}

export function useSaveFeatures() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (features: Feature[]) => saveFeatures(selectedOrg!, features),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["features", selectedOrg] }),
  });
}

export function useSaveSprint() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sprint: SprintConfig) => saveSprint(selectedOrg!, sprint),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sprint", selectedOrg] }),
  });
}

export function useSavePeople() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (people: Person[]) => savePeople(selectedOrg!, people),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["people", selectedOrg] }),
  });
}
