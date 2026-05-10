import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import {
  fetchSprint,
  saveSprint,
  fetchPeople,
  savePeople,
  fetchSettings,
  saveSettings,
  fetchAgentRules,
  saveAgentRules,
  fetchSprintSnapshots,
  saveSprintSnapshots,
  ensureConfigRepo,
  createConfigRepo,
} from "@/lib/config-repo";
import {
  fetchTodosByOwner as ghFetchTodosByOwner,
  createTodo as ghCreateTodo,
  updateTodo as ghUpdateTodo,
  deleteTodo as ghDeleteTodo,
  fetchTodosClosedInRange as ghFetchTodosClosedInRange,
} from "@/lib/github-todos";
import {
  fetchFeaturesFromD1,
  fetchAllFeaturesFromD1,
  createFeature as ghCreateFeature,
  updateFeature as ghUpdateFeature,
  deleteFeature as ghDeleteFeature,
  closeMilestone,
  reopenMilestone,
  findOrCreateMilestone,
  syncFeaturesFromGitHub,
} from "@/lib/github-features";
import { saveSnapshotToRepo, deleteSnapshotFromRepo } from "@/lib/unticket-repo";
import type { SprintConfig, Feature, FeatureStatus, Person, OrgSettings, Todo, TodoStatus, SprintSnapshot } from "@/lib/types";

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
    queryFn: fetchFeaturesFromD1,
    enabled: !!selectedOrg,
  });
}

/** All features including closed — for releases calendar. */
export function useAllFeatures() {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["allFeatures", selectedOrg],
    queryFn: fetchAllFeaturesFromD1,
    enabled: !!selectedOrg,
    staleTime: 5 * 60 * 1000,
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
    mutationFn: (args: { title: string; status: FeatureStatus; sprint: number | null; owners?: string[]; plan?: string }) =>
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

export function useTodos() {
  const { selectedOrg, user } = useAuth();
  return useQuery({
    queryKey: ["todos", selectedOrg, user?.login],
    queryFn: () => ghFetchTodosByOwner(selectedOrg!, user!.login!),
    enabled: !!selectedOrg && !!user?.login && user.login.length > 0,
    staleTime: 2 * 60 * 1000,
  });
}

export function useCreateTodoItem() {
  const { selectedOrg, user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { title: string; featureId?: number }) =>
      ghCreateTodo(selectedOrg!, args.title, user!.login, {
        featureId: args.featureId,
      }),
    onSuccess: (newTodo) => {
      qc.setQueryData<Todo[]>(["todos", selectedOrg, user?.login], (old) =>
        old ? [...old, newTodo] : [newTodo],
      );
    },
  });
}

export function useUpdateTodoItem() {
  const { selectedOrg, user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { issueNumber: number; updates: { title?: string; status?: TodoStatus; featureId?: number | null } }) =>
      ghUpdateTodo(selectedOrg!, args.issueNumber, args.updates),
    onMutate: async (args) => {
      const key = ["todos", selectedOrg, user?.login];
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Todo[]>(key);
      qc.setQueryData<Todo[]>(key, (old) =>
        old?.map((t) => {
          if (t.id !== args.issueNumber) return t;
          const { featureId, ...rest } = args.updates;
          return {
            ...t,
            ...rest,
            status: args.updates.status ?? t.status,
            featureId: featureId === null ? undefined : (featureId ?? t.featureId),
          };
        }) ?? [],
      );
      return { previous, key };
    },
    onSuccess: (result) => {
      const key = ["todos", selectedOrg, user?.login];
      qc.setQueryData<Todo[]>(key, (old) =>
        old?.map((t) => t.id === result.id ? result : t) ?? [],
      );
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(context.key, context.previous);
    },
  });
}

export function useDeleteTodoItem() {
  const { selectedOrg, user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (issueNumber: number) => ghDeleteTodo(selectedOrg!, issueNumber),
    onMutate: async (issueNumber) => {
      const key = ["todos", selectedOrg, user?.login];
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Todo[]>(key);
      qc.setQueryData<Todo[]>(key, (old) =>
        old?.filter((t) => t.id !== issueNumber) ?? [],
      );
      return { previous, key };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(context.key, context.previous);
    },
  });
}

export function useTodosClosedInRange(startDate: string | undefined, endDate: string | undefined) {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["todosClosedInRange", selectedOrg, startDate, endDate],
    queryFn: () => ghFetchTodosClosedInRange(selectedOrg!, null, startDate!, endDate!),
    enabled: !!selectedOrg && !!startDate && !!endDate,
    staleTime: 5 * 60 * 1000,
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

export function useSprintSnapshots() {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["sprintSnapshots", selectedOrg],
    queryFn: fetchSprintSnapshots,
    enabled: !!selectedOrg,
  });
}

export function useSaveSprintSnapshots() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (snapshots: SprintSnapshot[]) => saveSprintSnapshots(snapshots),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sprintSnapshots", selectedOrg] }),
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

// ---------- Sync Features ----------

export function useSyncFeatures() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: syncFeaturesFromGitHub,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["features", selectedOrg] }),
  });
}

// ---------- Sprint Advancement ----------

export function useAdvanceSprint() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      newSprint: SprintConfig;
      oldSprintNumber: number;
      features: Feature[];
      snapshot?: Omit<SprintSnapshot, "createdAt">;
      onProgress?: (done: number, total: number) => void;
    }) => {
      const { newSprint, oldSprintNumber, features, snapshot, onProgress } = args;
      const org = selectedOrg!;

      // 1. Save snapshot of the old sprint before advancing
      if (snapshot) {
        const fullSnapshot = { ...snapshot, createdAt: new Date().toISOString() };
        const existing = await fetchSprintSnapshots();
        const filtered = existing.filter((s) => s.sprintNumber !== snapshot.sprintNumber);
        await saveSprintSnapshots([...filtered, fullSnapshot]);
        // Also persist to unticket repo as a JSON file
        saveSnapshotToRepo(org, fullSnapshot as SprintSnapshot).catch(() => {});
      }

      // 2. Ensure the new milestone exists on GitHub first
      await findOrCreateMilestone(org, newSprint.number);

      const sprintFeatures = features.filter((f) => f.sprint === oldSprintNumber && f.status !== "future");
      const toClose = sprintFeatures.filter((f) => f.status === "production");
      const toMove = sprintFeatures.filter((f) => f.status !== "production");
      const total = toClose.length + toMove.length;
      const failed: number[] = [];
      let done = 0;

      // 3. Close features that are in production (close the GitHub issue)
      for (const f of toClose) {
        try {
          await ghDeleteFeature(org, f.id);
        } catch (e) {
          console.error(`[unticket] Failed to close feature #${f.id} during sprint advance:`, e);
          failed.push(f.id);
        }
        done++;
        onProgress?.(done, total);
      }

      // 4. Move all non-production features to the new sprint
      for (const f of toMove) {
        try {
          await ghUpdateFeature(org, { ...f, sprint: newSprint.number });
        } catch (e) {
          console.error(`[unticket] Failed to move feature #${f.id} to sprint ${newSprint.number}:`, e);
          failed.push(f.id);
        }
        done++;
        onProgress?.(done, total);
      }

      // 5. Only persist sprint config and close old milestone if all features processed
      if (failed.length === 0) {
        await saveSprint(newSprint);
        await closeMilestone(org, oldSprintNumber);
      }

      return { failed };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sprint", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["features", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["sprintSnapshots", selectedOrg] });
    },
  });
}

export function useRevertSprint() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { snapshot: SprintSnapshot }) => {
      const { snapshot } = args;
      const org = selectedOrg!;

      // 1. Restore sprint config from the snapshot
      await saveSprint({
        number: snapshot.sprintNumber,
        name: snapshot.name,
        startDate: snapshot.startDate,
        endDate: snapshot.endDate,
        focus: snapshot.focus,
      });

      // 2. Reopen the old milestone
      await reopenMilestone(org, snapshot.sprintNumber);

      // 3. Remove the snapshot from saved snapshots
      const existing = await fetchSprintSnapshots();
      const filtered = existing.filter((s) => s.sprintNumber !== snapshot.sprintNumber);
      await saveSprintSnapshots(filtered);
      // Also remove from unticket repo
      deleteSnapshotFromRepo(org, snapshot.sprintNumber).catch(() => {});
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sprint", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["features", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["sprintSnapshots", selectedOrg] });
    },
  });
}
