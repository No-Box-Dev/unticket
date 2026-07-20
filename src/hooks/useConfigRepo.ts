import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import {
  fetchPeople,
  savePeople,
  fetchSettings,
  saveSettings,
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

// Monotonically decreasing temp id for optimistic feature cards. Stays
// negative so it can never collide with a real GitHub issue number.
let nextTempFeatureId = -1;

export function useCreateFeature() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      title: string;
      status: FeatureStatus;
      owners?: string[];
      plan?: string;
      linkedSpecIds?: number[];
    }) =>
      ghCreateFeature(selectedOrg!, args.title, args),
    // Optimistic: drop a pending card into the target column immediately, then
    // swap it for the real feature once GitHub assigns an issue number. Without
    // this the user waits ~2s for the synchronous GitHub round-trip before the
    // card appears. Mirrors the optimistic update/delete hooks below.
    onMutate: async (args) => {
      await qc.cancelQueries({ queryKey: ["features", selectedOrg] });
      const tempId = nextTempFeatureId--;
      const optimistic: Feature = {
        id: tempId,
        title: args.title,
        owners: args.owners ?? [],
        status: args.status,
        plan: args.plan,
        pending: true,
      };
      qc.setQueryData<Feature[]>(["features", selectedOrg], (old) =>
        old ? [...old, optimistic] : [optimistic],
      );
      return { tempId };
    },
    onSuccess: (newFeature, _args, context) => {
      qc.setQueryData<Feature[]>(["features", selectedOrg], (old) => {
        const list = old ?? [];
        // Normal path: swap the temp card for the real feature.
        if (list.some((f) => f.id === context?.tempId)) {
          return list.map((f) => (f.id === context?.tempId ? newFeature : f));
        }
        // The temp card vanished (e.g. a background refetch replaced the cache
        // during the ~2s round-trip). Append the real feature so the create
        // never silently disappears — but guard against a refetch that already
        // included it, to avoid a duplicate.
        return list.some((f) => f.id === newFeature.id) ? list : [...list, newFeature];
      });
    },
    onError: (_err, _args, context) => {
      // Surgically drop just the failed optimistic card by its tempId. We
      // can't restore a pre-mutate snapshot: on the first create the cache is
      // empty, and `setQueryData(key, undefined)` is a no-op in TanStack Query
      // — the ghost pending card would stay stuck forever. Filtering by tempId
      // also avoids clobbering any concurrent cache changes.
      qc.setQueryData<Feature[]>(["features", selectedOrg], (old) =>
        old ? old.filter((f) => f.id !== context?.tempId) : old,
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

// ---------- Bulk clean: close all features in the last configured stage ----------

export function useCleanDoneFeatures() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ features, stageId }: { features: Feature[]; stageId: string }) => {
      const org = selectedOrg!;
      const done = features.filter((f) => f.status === stageId);
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
