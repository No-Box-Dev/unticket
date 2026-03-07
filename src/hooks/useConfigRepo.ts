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
  fetchAgentRules,
  saveAgentRules,
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
  closeMilestone,
  findOrCreateMilestone,
  fetchSubIssues,
  createSubIssue,
  toggleSubIssue,
  updateSubIssueAssignees,
  deleteSubIssue,
} from "@/lib/github-features";
import type { SubIssue } from "@/lib/github-features";
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
    onSettled: () => qc.invalidateQueries({ queryKey: ["features", selectedOrg] }),
  });
}

// ---------- Sub-issues ----------

export function useSubIssues(featureId: number) {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["subIssues", selectedOrg, featureId],
    queryFn: () => fetchSubIssues(selectedOrg!, featureId),
    enabled: !!selectedOrg && featureId > 0,
  });
}

export function useCreateSubIssue() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { parentIssueNumber: number; title: string; assignees?: string[] }) =>
      createSubIssue(selectedOrg!, args.parentIssueNumber, args.title, args.assignees),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["subIssues", selectedOrg, vars.parentIssueNumber] });
    },
  });
}

export function useToggleSubIssue() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sub: SubIssue) => toggleSubIssue(selectedOrg!, sub),
    onMutate: async (sub) => {
      const key = ["subIssues", selectedOrg];
      await qc.cancelQueries({ queryKey: key });
      const queries = qc.getQueriesData<SubIssue[]>({ queryKey: key });
      const previous = new Map<string, SubIssue[]>();
      for (const [qKey, data] of queries) {
        if (data?.some((s) => s.id === sub.id)) {
          previous.set(JSON.stringify(qKey), data);
          qc.setQueryData<SubIssue[]>(qKey, (old) =>
            old?.map((s) => s.id === sub.id ? { ...s, state: s.state === "open" ? "closed" : "open" } : s) ?? [],
          );
        }
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        for (const [key, data] of context.previous) {
          qc.setQueryData(JSON.parse(key), data);
        }
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["subIssues", selectedOrg] });
    },
  });
}

export function useUpdateSubIssueAssignees() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { subIssueNumber: number; assignees: string[] }) =>
      updateSubIssueAssignees(selectedOrg!, args.subIssueNumber, args.assignees),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["subIssues", selectedOrg] });
    },
  });
}

export function useDeleteSubIssue() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { parentIssueNumber: number; subIssueNumber: number }) =>
      deleteSubIssue(selectedOrg!, args.subIssueNumber),
    onMutate: async (args) => {
      const key = ["subIssues", selectedOrg, args.parentIssueNumber];
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<SubIssue[]>(key);
      qc.setQueryData<SubIssue[]>(key, (old) =>
        old?.filter((s) => s.number !== args.subIssueNumber) ?? [],
      );
      return { previous, key };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(context.key, context.previous);
    },
    onSettled: (_data, _err, args) => {
      qc.invalidateQueries({ queryKey: ["subIssues", selectedOrg, args.parentIssueNumber] });
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
      qc.invalidateQueries({ queryKey: ["sprint", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["features", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["people", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["settings", selectedOrg] });
    },
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
      onProgress?: (done: number, total: number) => void;
    }) => {
      const { newSprint, oldSprintNumber, features, onProgress } = args;
      const org = selectedOrg!;

      // 1. Ensure the new milestone exists on GitHub first
      await findOrCreateMilestone(org, newSprint.number);

      // 2. Move plan/demo features to new sprint
      const toMove = features.filter(
        (f) => f.sprint === oldSprintNumber && (f.status === "plan" || f.status === "demo"),
      );
      const failed: number[] = [];
      let done = 0;
      for (const f of toMove) {
        try {
          await ghUpdateFeature(org, { ...f, sprint: newSprint.number });
        } catch {
          failed.push(f.id);
        }
        done++;
        onProgress?.(done, toMove.length);
      }

      // 3. Only persist sprint config and close old milestone if all features moved
      if (failed.length === 0) {
        await saveSprint(newSprint);
        await closeMilestone(org, oldSprintNumber);
      }

      return { failed };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sprint", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["features", selectedOrg] });
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
