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
  createConfigRepo,
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
    onMutate: async (features) => {
      await qc.cancelQueries({ queryKey: ["features", selectedOrg] });
      const previous = qc.getQueryData<Feature[]>(["features", selectedOrg]);
      qc.setQueryData(["features", selectedOrg], features);
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(["features", selectedOrg], context.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["features", selectedOrg] }),
  });
}

export function useSaveSprint() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sprint: SprintConfig) => saveSprint(selectedOrg!, sprint),
    onMutate: async (sprint) => {
      await qc.cancelQueries({ queryKey: ["sprint", selectedOrg] });
      const previous = qc.getQueryData<SprintConfig>(["sprint", selectedOrg]);
      qc.setQueryData(["sprint", selectedOrg], sprint);
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(["sprint", selectedOrg], context.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["sprint", selectedOrg] }),
  });
}

export function useSavePeople() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (people: Person[]) => savePeople(selectedOrg!, people),
    onMutate: async (people) => {
      await qc.cancelQueries({ queryKey: ["people", selectedOrg] });
      const previous = qc.getQueryData<Person[]>(["people", selectedOrg]);
      qc.setQueryData(["people", selectedOrg], people);
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(["people", selectedOrg], context.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["people", selectedOrg] }),
  });
}

export function useCreateConfigRepo() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => createConfigRepo(selectedOrg!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["configRepo", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["sprint", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["features", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["people", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["settings", selectedOrg] });
    },
  });
}
