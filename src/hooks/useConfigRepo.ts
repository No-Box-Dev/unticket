import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import {
  fetchPeople,
  savePeople,
  fetchSettings,
  saveSettings,
  fetchAgentRules,
  saveAgentRules,
  ensureConfigRepo,
  createConfigRepo,
} from "@/lib/config-repo";
import {
  fetchFeaturesFromD1,
  createFeature as ghCreateFeature,
  updateFeature as ghUpdateFeature,
  deleteFeature as ghDeleteFeature,
} from "@/lib/github-features";
import type { Feature, FeatureStatus, Person, OrgSettings } from "@/lib/types";

export function useConfigRepoExists() {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["configRepo", selectedOrg],
    queryFn: ensureConfigRepo,
    enabled: !!selectedOrg,
    staleTime: 5 * 60 * 1000,
  });
}

export function useFeatures() {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["features", selectedOrg],
    queryFn: fetchFeaturesFromD1,
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
    queryFn: fetchSettings,
    enabled: !!selectedOrg,
  });
}

export function useCreateFeature() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { title: string; status: FeatureStatus; owners?: string[]; plan?: string }) =>
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
    onSuccess: (result) => {
      // Set cache from server response — avoids D1 replica lag overwriting optimistic update
      qc.setQueryData<Feature[]>(["features", selectedOrg], (old) =>
        old?.map((f) => (f.id === result.id ? result : f)) ?? [],
      );
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(["features", selectedOrg], context.previous);
    },
  });
}

export function useDeleteFeature() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => {
      return ghDeleteFeature(selectedOrg!, id);
    },
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

export function useAgentRules() {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["agentRules", selectedOrg],
    queryFn: fetchAgentRules,
    enabled: !!selectedOrg,
  });
}

export function useSaveAgentRules() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rules: string[]) => saveAgentRules(rules),
    onMutate: async (rules) => {
      await qc.cancelQueries({ queryKey: ["agentRules", selectedOrg] });
      const previous = qc.getQueryData<string[]>(["agentRules", selectedOrg]);
      qc.setQueryData(["agentRules", selectedOrg], rules);
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(["agentRules", selectedOrg], context.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["agentRules", selectedOrg] }),
  });
}

export function useCreateConfigRepo() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createConfigRepo,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["configRepo", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["features", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["people", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["settings", selectedOrg] });
    },
  });
}

// ---------- Bulk clean: close all features in production status ----------

export function useCleanDoneFeatures() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (features: Feature[]) => {
      const org = selectedOrg!;
      const done = features.filter((f) => f.status === "production");
      const failed: number[] = [];
      for (const f of done) {
        try {
          await ghDeleteFeature(org, f.id);
        } catch (e) {
          console.error(`[unticket] Failed to clean done feature #${f.id}:`, e);
          failed.push(f.id);
        }
      }
      return { cleaned: done.length - failed.length, failed };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["features", selectedOrg] }),
  });
}
