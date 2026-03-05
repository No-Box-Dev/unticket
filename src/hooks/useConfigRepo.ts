import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import {
  fetchSprint,
  saveSprint,
  fetchPeople,
  savePeople,
  fetchSettings,
  saveSettings,
  fetchTodos,
  saveTodos,
  ensureConfigRepo,
  createConfigRepo,
} from "@/lib/config-repo";
import {
  fetchFeatures as ghFetchFeatures,
  createFeature as ghCreateFeature,
  updateFeature as ghUpdateFeature,
  deleteFeature as ghDeleteFeature,
  migrateFeatures as ghMigrateFeatures,
  fetchLegacyFeatures,
} from "@/lib/github-features";
import type { LegacyFeature } from "@/lib/github-features";
import type { SprintConfig, Feature, FeatureStatus, Effort, Priority, Person, OrgSettings, Todo } from "@/lib/types";

export function useConfigRepoExists() {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["configRepo", selectedOrg],
    queryFn: ensureConfigRepo,
    enabled: !!selectedOrg,
    staleTime: 5 * 60 * 1000,
  });
}

export function useSprint() {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["sprint", selectedOrg],
    queryFn: fetchSprint,
    enabled: !!selectedOrg,
  });
}

export function useFeatures() {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["features", selectedOrg],
    queryFn: () => ghFetchFeatures(selectedOrg!),
    enabled: !!selectedOrg,
  });
}

export function usePeople() {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["people", selectedOrg],
    queryFn: fetchPeople,
    enabled: !!selectedOrg,
  });
}

export function useSettings() {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["settings", selectedOrg],
    queryFn: fetchSettings,
    enabled: !!selectedOrg,
  });
}

export function useCreateFeature() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { title: string; status: FeatureStatus; sprint: number | null; effort: Effort; team?: string; priority?: Priority; owners?: string[]; plan?: string }) =>
      ghCreateFeature(selectedOrg!, args.title, args),
    onSuccess: (newFeature) => {
      qc.setQueryData<Feature[]>(["features", selectedOrg], (old) =>
        old ? [...old, newFeature] : [newFeature],
      );
    },
  });
}

export function useUpdateFeature() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (updated: Feature) => ghUpdateFeature(selectedOrg!, updated),
    onMutate: async (updated) => {
      await qc.cancelQueries({ queryKey: ["features", selectedOrg] });
      const previous = qc.getQueryData<Feature[]>(["features", selectedOrg]);
      qc.setQueryData<Feature[]>(["features", selectedOrg], (old) =>
        old?.map((f) => (f.id === updated.id ? updated : f)) ?? [],
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(["features", selectedOrg], context.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["features", selectedOrg] }),
  });
}

export function useDeleteFeature() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => ghDeleteFeature(selectedOrg!, id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["features", selectedOrg] });
      const previous = qc.getQueryData<Feature[]>(["features", selectedOrg]);
      qc.setQueryData<Feature[]>(["features", selectedOrg], (old) =>
        old?.filter((f) => f.id !== id) ?? [],
      );
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
    mutationFn: (sprint: SprintConfig) => saveSprint(sprint),
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
    mutationFn: (people: Person[]) => savePeople(people),
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

export function useSaveSettings() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (settings: OrgSettings) => saveSettings(settings),
    onMutate: async (settings) => {
      await qc.cancelQueries({ queryKey: ["settings", selectedOrg] });
      const previous = qc.getQueryData<OrgSettings>(["settings", selectedOrg]);
      qc.setQueryData(["settings", selectedOrg], settings);
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(["settings", selectedOrg], context.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["settings", selectedOrg] }),
  });
}

export function useTodos() {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["todos", selectedOrg],
    queryFn: fetchTodos,
    enabled: !!selectedOrg,
  });
}

export function useSaveTodos() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (todos: Todo[]) => saveTodos(todos),
    onMutate: async (todos) => {
      await qc.cancelQueries({ queryKey: ["todos", selectedOrg] });
      const previous = qc.getQueryData<Todo[]>(["todos", selectedOrg]);
      qc.setQueryData(["todos", selectedOrg], todos);
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(["todos", selectedOrg], context.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["todos", selectedOrg] }),
  });
}

export function useCreateConfigRepo() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createConfigRepo,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["configRepo", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["sprint", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["features", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["people", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["settings", selectedOrg] });
    },
  });
}

// ---------- Migration ----------

export function useLegacyFeatures() {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["legacyFeatures", selectedOrg],
    queryFn: fetchLegacyFeatures,
    enabled: !!selectedOrg,
    staleTime: Infinity,
  });
}

export function useMigrateFeatures() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { legacy: LegacyFeature[]; onProgress?: (done: number, total: number) => void }) =>
      ghMigrateFeatures(selectedOrg!, args.legacy, args.onProgress),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["features", selectedOrg] });
    },
  });
}
