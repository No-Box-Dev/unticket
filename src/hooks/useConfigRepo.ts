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
  migrateFeatures as ghMigrateFeatures,
  fetchLegacyFeatures,
  closeMilestone,
  reopenMilestone,
  findOrCreateMilestone,
  fetchSubIssues,
  createSubIssue,
  toggleSubIssue,
  updateSubIssueAssignees,
  deleteSubIssue,
  syncFeaturesFromGitHub,
  fetchRoles,
  createRole as ghCreateRole,
  deleteRole as ghDeleteRole,
  fetchTasksForRole,
  createTask as ghCreateTask,
  updateTaskPoints as ghUpdateTaskPoints,
  updateTaskTitle as ghUpdateTaskTitle,
} from "@/lib/github-features";
import type { SubIssue } from "@/lib/github-features";
import type { LegacyFeature } from "@/lib/github-features";
import { saveSnapshotToRepo, deleteSnapshotFromRepo } from "@/lib/gitpulse-repo";
import { useRef } from "react";
import type { SprintConfig, Feature, FeatureStatus, Person, OrgSettings, Todo, TodoStatus, SprintSnapshot, Points, PersonRole } from "@/lib/types";

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

// ---------- Bulk sub-issues for sprint ----------

export interface SubIssueWithFeature {
  featureId: number;
  featureTitle: string;
  id: number;
  number: number;
  title: string;
  state: "open" | "closed";
  assignees: string[];
  html_url: string;
  points?: Points;
  roleNumber?: number;
  roleName?: string;
  closed_at?: string | null;
}

export function useAllSprintSubIssues(featureIds: number[]) {
  const { selectedOrg } = useAuth();
  return useQuery<SubIssueWithFeature[]>({
    queryKey: ["allSprintSubIssues", selectedOrg, featureIds],
    queryFn: async () => {
      if (!selectedOrg || featureIds.length === 0) return [];

      // Phase 1: Fetch all sub-issues + roles for all features in parallel batches
      const featureData: { fid: number; subs: SubIssue[]; roles: PersonRole[] }[] = [];
      const BATCH_SIZE = 10;
      for (let i = 0; i < featureIds.length; i += BATCH_SIZE) {
        const batch = featureIds.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map(async (fid) => {
            try {
              const [subs, roles] = await Promise.all([
                fetchSubIssues(selectedOrg, fid),
                fetchRoles(selectedOrg, fid),
              ]);
              return { fid, subs, roles };
            } catch {
              return { fid, subs: [] as SubIssue[], roles: [] as PersonRole[] };
            }
          }),
        );
        featureData.push(...batchResults);
      }

      // Phase 2: Collect ALL roles across ALL features, then fetch their tasks in one flat batch
      // This avoids nested parallelism (was: per-feature → per-role → fetchTasksForRole)
      const allRoleRequests: { fid: number; role: PersonRole }[] = [];
      for (const { fid, roles } of featureData) {
        for (const role of roles) {
          allRoleRequests.push({ fid, role });
        }
      }

      const roleTaskMap = new Map<number, SubIssue[]>();
      for (let i = 0; i < allRoleRequests.length; i += BATCH_SIZE) {
        const batch = allRoleRequests.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(
          batch.map(async ({ role }) => {
            try {
              return { roleNumber: role.number, tasks: await fetchTasksForRole(selectedOrg, role.number) };
            } catch {
              return { roleNumber: role.number, tasks: [] as SubIssue[] };
            }
          }),
        );
        for (const { roleNumber, tasks } of results) {
          roleTaskMap.set(roleNumber, tasks);
        }
      }

      // Phase 3: Assemble results
      const results: SubIssueWithFeature[] = [];
      for (const { fid, subs, roles } of featureData) {
        const roleNumbers = new Set(roles.map((r) => r.number));

        // Direct tasks (not roles) — legacy flat sub-issues
        for (const s of subs) {
          if (!roleNumbers.has(s.number)) {
            results.push({ ...s, featureId: fid, featureTitle: "" });
          }
        }

        // Tasks under roles
        for (const role of roles) {
          const tasks = roleTaskMap.get(role.number) ?? [];
          for (const t of tasks) {
            results.push({
              ...t,
              featureId: fid,
              featureTitle: "",
              roleNumber: role.number,
              roleName: role.title,
            });
          }
        }
      }

      return results;
    },
    enabled: !!selectedOrg && featureIds.length > 0,
    staleTime: 3 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

// ---------- Sub-issues ----------

export function useSubIssues(featureId: number) {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["subIssues", selectedOrg, featureId],
    queryFn: () => fetchSubIssues(selectedOrg!, featureId),
    enabled: !!selectedOrg && featureId > 0,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
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
      const newState = sub.state === "open" ? "closed" : "open";

      // Optimistic update for flat sub-issues cache
      const subKey = ["subIssues", selectedOrg];
      await qc.cancelQueries({ queryKey: subKey });
      const subQueries = qc.getQueriesData<SubIssue[]>({ queryKey: subKey });
      const previousSubs: [readonly unknown[], SubIssue[]][] = [];
      for (const [qKey, data] of subQueries) {
        if (data?.some((s) => s.number === sub.number)) {
          previousSubs.push([qKey, data]);
          qc.setQueryData<SubIssue[]>(qKey, (old) =>
            old?.map((s) => s.number === sub.number ? { ...s, state: newState } : s) ?? [],
          );
        }
      }

      // Optimistic update for rolesWithTasks cache (tasks inside roles)
      const rwKey = ["rolesWithTasks", selectedOrg];
      await qc.cancelQueries({ queryKey: rwKey });
      const rwQueries = qc.getQueriesData<RoleWithTasks[]>({ queryKey: rwKey });
      const previousRoles: [readonly unknown[], RoleWithTasks[]][] = [];
      for (const [qKey, data] of rwQueries) {
        const hasTask = data?.some((r) => r.tasks.some((t) => t.id === sub.id));
        if (hasTask) {
          previousRoles.push([qKey, data!]);
          qc.setQueryData<RoleWithTasks[]>(qKey, (old) =>
            (old ?? []).map((r) => {
              const taskIdx = r.tasks.findIndex((t) => t.id === sub.id);
              if (taskIdx === -1) return r;
              const tasks = r.tasks.map((t) =>
                t.id === sub.id ? { ...t, state: newState as "open" | "closed" } : t,
              );
              const donePoints = tasks
                .filter((t) => t.state === "closed")
                .reduce((sum, t) => sum + (t.points ?? 0), 0);
              return { ...r, tasks, donePoints };
            }),
          );
        }
      }

      return { previousSubs, previousRoles };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousSubs) {
        for (const [key, data] of context.previousSubs) {
          qc.setQueryData(key, data);
        }
      }
      if (context?.previousRoles) {
        for (const [key, data] of context.previousRoles) {
          qc.setQueryData(key, data);
        }
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["subIssues", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["rolesWithTasks", selectedOrg] });
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
    mutationFn: (args: { parentIssueNumber: number; subIssueNumber: number; featureId?: number }) =>
      deleteSubIssue(selectedOrg!, args.subIssueNumber),
    onMutate: async (args) => {
      const key = ["subIssues", selectedOrg, args.parentIssueNumber];
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<SubIssue[]>(key);
      qc.setQueryData<SubIssue[]>(key, (old) =>
        old?.filter((s) => s.number !== args.subIssueNumber) ?? [],
      );
      // Also optimistically remove from rolesWithTasks cache
      if (args.featureId) {
        const rtKey = ["rolesWithTasks", selectedOrg, args.featureId];
        qc.setQueryData<RoleWithTasks[]>(rtKey, (old) =>
          old?.map((rw) => ({
            ...rw,
            tasks: rw.tasks.filter((t) => t.number !== args.subIssueNumber),
            totalPoints: rw.tasks.filter((t) => t.number !== args.subIssueNumber).reduce((sum, t) => sum + (t.points ?? 0), 0),
            donePoints: rw.tasks.filter((t) => t.number !== args.subIssueNumber && t.state === "closed").reduce((sum, t) => sum + (t.points ?? 0), 0),
          })) ?? [],
        );
      }
      return { previous, key };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(context.key, context.previous);
    },
    onSettled: (_data, _err, args) => {
      qc.invalidateQueries({ queryKey: ["subIssues", selectedOrg, args.parentIssueNumber] });
      if (args.featureId) {
        qc.invalidateQueries({ queryKey: ["rolesWithTasks", selectedOrg, args.featureId] });
      }
      // Also invalidate the sprint-wide sub-issues query
      qc.invalidateQueries({ queryKey: ["allSprintSubIssues", selectedOrg] });
    },
  });
}

// ---------- Roles ----------

export function useRoles(featureId: number) {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["roles", selectedOrg, featureId],
    queryFn: () => fetchRoles(selectedOrg!, featureId),
    enabled: !!selectedOrg && featureId > 0,
    staleTime: 3 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useTasksForRole(roleNumber: number) {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["roleTasks", selectedOrg, roleNumber],
    queryFn: () => fetchTasksForRole(selectedOrg!, roleNumber),
    enabled: !!selectedOrg && roleNumber > 0,
    staleTime: 3 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export interface RoleWithTasks {
  role: PersonRole;
  tasks: SubIssue[];
  totalPoints: number;
  donePoints: number;
}

export function useRolesWithTasks(featureId: number) {
  const { selectedOrg } = useAuth();
  return useQuery<RoleWithTasks[]>({
    queryKey: ["rolesWithTasks", selectedOrg, featureId],
    queryFn: async () => {
      if (!selectedOrg) return [];
      const roles = await fetchRoles(selectedOrg, featureId);
      const results = await Promise.all(
        roles.map(async (role) => {
          try {
            const tasks = await fetchTasksForRole(selectedOrg, role.number);
            const totalPoints = tasks.reduce((sum, t) => sum + (t.points ?? 0), 0);
            const donePoints = tasks
              .filter((t) => t.state === "closed")
              .reduce((sum, t) => sum + (t.points ?? 0), 0);
            return { role, tasks, totalPoints, donePoints };
          } catch {
            return { role, tasks: [], totalPoints: 0, donePoints: 0 };
          }
        }),
      );
      return results;
    },
    enabled: !!selectedOrg && featureId > 0,
    staleTime: 3 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useCreateRole() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  const tempIdRef = useRef(-1);
  return useMutation({
    mutationFn: (args: { featureId: number; title: string; assignee?: string }) =>
      ghCreateRole(selectedOrg!, args.featureId, args.title, args.assignee),
    onMutate: async (args) => {
      const key = ["rolesWithTasks", selectedOrg, args.featureId];
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<RoleWithTasks[]>(key);
      const id = tempIdRef.current--;
      const optimisticRole: PersonRole = {
        id,
        number: id,
        title: args.title,
        assignee: args.assignee ?? null,
        state: "open",
        html_url: "",
      };
      qc.setQueryData<RoleWithTasks[]>(key, (old) => [
        ...(old ?? []),
        { role: optimisticRole, tasks: [], totalPoints: 0, donePoints: 0 },
      ]);
      return { previous, key, tempId: id };
    },
    onSuccess: (realRole, _vars, context) => {
      // Replace the optimistic placeholder with the real role from GitHub (match by temp ID, not title)
      if (!context) return;
      qc.setQueryData<RoleWithTasks[]>(context.key, (old) =>
        (old ?? []).map((r) =>
          r.role.id === context.tempId
            ? { ...r, role: realRole }
            : r,
        ),
      );
    },
    onError: (err, _vars, context) => {
      console.error("[unticket.ai] createRole failed:", err);
      if (context?.previous) qc.setQueryData(context.key, context.previous);
    },
  });
}

export function useDeleteRole() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { featureId: number; roleNumber: number }) =>
      ghDeleteRole(selectedOrg!, args.roleNumber),
    onMutate: async (args) => {
      const key = ["rolesWithTasks", selectedOrg, args.featureId];
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<RoleWithTasks[]>(key);
      qc.setQueryData<RoleWithTasks[]>(key, (old) =>
        (old ?? []).filter((r) => r.role.number !== args.roleNumber),
      );
      return { previous, key };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(context.key, context.previous);
    },
  });
}

export function useCreateTask() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  const tempIdRef = useRef(-1000);
  return useMutation({
    mutationFn: (args: { roleNumber: number; featureId: number; title: string; points?: Points; assignee?: string }) =>
      ghCreateTask(selectedOrg!, args.roleNumber, args.title, args.points, args.assignee),
    onMutate: async (args) => {
      const key = ["rolesWithTasks", selectedOrg, args.featureId];
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<RoleWithTasks[]>(key);
      const taskId = tempIdRef.current--;
      const optimisticTask: SubIssue = {
        id: taskId,
        number: taskId,
        title: args.title,
        state: "open",
        assignees: args.assignee ? [args.assignee] : [],
        html_url: "",
        points: args.points,
        roleNumber: args.roleNumber,
      };
      qc.setQueryData<RoleWithTasks[]>(key, (old) =>
        (old ?? []).map((r) => {
          if (r.role.number !== args.roleNumber) return r;
          const tasks = [...r.tasks, optimisticTask];
          return {
            ...r,
            tasks,
            totalPoints: r.totalPoints + (args.points ?? 0),
          };
        }),
      );
      return { previous, key, tempTaskId: taskId };
    },
    onSuccess: (realTask, vars, context) => {
      // Replace the optimistic placeholder with the real task (match by temp ID, not title)
      if (!context) return;
      const key = ["rolesWithTasks", selectedOrg, vars.featureId];
      qc.setQueryData<RoleWithTasks[]>(key, (old) =>
        (old ?? []).map((r) => {
          if (r.role.number !== vars.roleNumber) return r;
          return {
            ...r,
            tasks: r.tasks.map((t) =>
              t.id === context.tempTaskId ? realTask : t,
            ),
          };
        }),
      );
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(context.key, context.previous);
    },
  });
}

export function useUpdateTaskPoints() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { taskNumber: number; points: Points | undefined }) =>
      ghUpdateTaskPoints(selectedOrg!, args.taskNumber, args.points),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["roleTasks", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["rolesWithTasks", selectedOrg] });
    },
  });
}

export function useUpdateTaskTitle() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { taskNumber: number; featureId: number; title: string }) =>
      ghUpdateTaskTitle(selectedOrg!, args.taskNumber, args.title),
    onMutate: async (args) => {
      // Optimistic update in rolesWithTasks cache
      const key = ["rolesWithTasks", selectedOrg, args.featureId];
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<RoleWithTasks[]>(key);
      qc.setQueryData<RoleWithTasks[]>(key, (old) =>
        (old ?? []).map((r) => ({
          ...r,
          tasks: r.tasks.map((t) =>
            t.number === args.taskNumber ? { ...t, title: args.title } : t,
          ),
        })),
      );
      return { previous, key };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(context.key, context.previous);
    },
    onSettled: (_data, _err, args) => {
      qc.invalidateQueries({ queryKey: ["rolesWithTasks", selectedOrg, args.featureId] });
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
        // Also persist to gitpulse repo as a JSON file
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
        } catch {
          failed.push(f.id);
        }
        done++;
        onProgress?.(done, total);
      }

      // 4. Move all non-production features to the new sprint
      for (const f of toMove) {
        try {
          await ghUpdateFeature(org, { ...f, sprint: newSprint.number });
        } catch {
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
      // Also remove from gitpulse repo
      deleteSnapshotFromRepo(org, snapshot.sprintNumber).catch(() => {});
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sprint", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["features", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["sprintSnapshots", selectedOrg] });
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
