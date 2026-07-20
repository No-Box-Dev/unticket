import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import {
  archiveSpec,
  archiveSpecFolder,
  createSpec,
  createSpecFolder,
  fetchSpec,
  fetchSpecFolders,
  fetchSpecs,
  unarchiveSpec,
  unarchiveSpecFolder,
  updateSpec,
  updateSpecFolder,
  type SpecFolderFilter,
} from "@/lib/specs-api";
import type { Spec, SpecFolder, SpecLink } from "@/lib/types";

// Query keys (kept in one place so cache updates in mutations stay in sync).
const folderKey = (org: string | null, includeArchived: boolean) =>
  ["specFolders", org, { includeArchived }] as const;
const specsKey = (
  org: string | null,
  filter: { folderId?: SpecFolderFilter; includeArchived?: boolean },
) => ["specs", org, filter] as const;
const specKey = (org: string | null, id: number | null) => ["spec", org, id] as const;

// Monotonically decreasing temp ids for optimistic creates. Stay negative so
// they never collide with real D1 rowids.
let nextTempFolderId = -1;
let nextTempSpecId = -1;

// ---------- Folders ----------

export function useSpecFolders(opts: { includeArchived?: boolean } = {}) {
  const { selectedOrg } = useAuth();
  const includeArchived = !!opts.includeArchived;
  return useQuery({
    queryKey: folderKey(selectedOrg, includeArchived),
    queryFn: async () => (await fetchSpecFolders(includeArchived)).folders,
    enabled: !!selectedOrg,
  });
}

export function useCreateSpecFolder() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; description?: string; owner?: string | null }) =>
      createSpecFolder(input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ["specFolders", selectedOrg] });
      const tempId = nextTempFolderId--;
      const optimistic: SpecFolder = {
        id: tempId,
        name: input.name,
        description: input.description ?? null,
        owner: input.owner ?? null,
        archived: false,
        archivedAt: null,
        createdBy: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        specCount: 0,
      };
      // Insert into both active-only and all-included cache slots.
      for (const inc of [false, true]) {
        qc.setQueryData<SpecFolder[]>(folderKey(selectedOrg, inc), (old) =>
          old ? [...old, optimistic] : [optimistic],
        );
      }
      return { tempId };
    },
    onSuccess: (newFolder, _input, context) => {
      for (const inc of [false, true]) {
        qc.setQueryData<SpecFolder[]>(folderKey(selectedOrg, inc), (old) => {
          const list = old ?? [];
          if (list.some((f) => f.id === context?.tempId)) {
            return list.map((f) => (f.id === context?.tempId ? newFolder : f));
          }
          return list.some((f) => f.id === newFolder.id) ? list : [...list, newFolder];
        });
      }
    },
    onError: (_err, _input, context) => {
      for (const inc of [false, true]) {
        qc.setQueryData<SpecFolder[]>(folderKey(selectedOrg, inc), (old) =>
          old ? old.filter((f) => f.id !== context?.tempId) : old,
        );
      }
    },
  });
}

export function useUpdateSpecFolder() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      id: number;
      name?: string;
      description?: string | null;
      owner?: string | null;
    }) =>
      updateSpecFolder(args.id, {
        name: args.name,
        description: args.description,
        owner: args.owner,
      }),
    onMutate: async (args) => {
      await qc.cancelQueries({ queryKey: ["specFolders", selectedOrg] });
      const snapshots: { key: readonly unknown[]; prev: SpecFolder[] | undefined }[] = [];
      for (const inc of [false, true]) {
        const key = folderKey(selectedOrg, inc);
        snapshots.push({ key, prev: qc.getQueryData<SpecFolder[]>(key) });
        qc.setQueryData<SpecFolder[]>(key, (old) =>
          old?.map((f) =>
            f.id === args.id
              ? {
                  ...f,
                  name: args.name ?? f.name,
                  description: args.description !== undefined ? args.description : f.description,
                  owner: args.owner !== undefined ? args.owner : f.owner,
                }
              : f,
          ) ?? [],
        );
      }
      return { snapshots };
    },
    onSuccess: (result) => {
      for (const inc of [false, true]) {
        qc.setQueryData<SpecFolder[]>(folderKey(selectedOrg, inc), (old) =>
          old?.map((f) => (f.id === result.id ? result : f)) ?? [],
        );
      }
    },
    onError: (_err, _args, context) => {
      if (!context) return;
      for (const s of context.snapshots) {
        if (s.prev !== undefined) qc.setQueryData(s.key, s.prev);
      }
    },
  });
}

export function useSetSpecFolderArchived() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: number; archived: boolean }) =>
      args.archived ? archiveSpecFolder(args.id) : unarchiveSpecFolder(args.id),
    onSuccess: (result) => {
      // Refetch folders so counts, membership, and the Archive section update
      // together — the response tells us the cascaded spec ids too, so patch
      // those into every specs cache without waiting for a refetch.
      qc.invalidateQueries({ queryKey: ["specFolders", selectedOrg] });
      if (result.archived && result.cascadedSpecIds?.length) {
        const ids = new Set(result.cascadedSpecIds);
        const nowIso = new Date().toISOString();
        qc.getQueryCache()
          .findAll({ queryKey: ["specs", selectedOrg] })
          .forEach((entry) => {
            const data = entry.state.data as Spec[] | undefined;
            if (!data) return;
            qc.setQueryData<Spec[]>(
              entry.queryKey,
              data.map((s) =>
                ids.has(s.id) ? { ...s, archived: true, archivedAt: nowIso } : s,
              ),
            );
          });
      }
      // Always refetch specs so the sidebar/list reflects the new state
      // (archived specs appear/disappear based on the caller's include flag).
      qc.invalidateQueries({ queryKey: ["specs", selectedOrg] });
    },
  });
}

// ---------- Specs ----------

export function useSpecs(
  filter: { folderId?: SpecFolderFilter; includeArchived?: boolean } = {},
) {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: specsKey(selectedOrg, filter),
    queryFn: async () => (await fetchSpecs(filter)).specs,
    enabled: !!selectedOrg,
  });
}

export function useSpec(id: number | null) {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: specKey(selectedOrg, id),
    queryFn: () => fetchSpec(id!),
    enabled: !!selectedOrg && id != null && id > 0,
  });
}

export function useCreateSpec() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      title: string;
      description?: string;
      folderId?: number | null;
      links?: SpecLink[];
    }) => createSpec(input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ["specs", selectedOrg] });
      const tempId = nextTempSpecId--;
      const optimistic: Spec = {
        id: tempId,
        folderId: input.folderId ?? null,
        title: input.title,
        description: input.description ?? "",
        links: input.links ?? [],
        archived: false,
        archivedAt: null,
        createdBy: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      // Optimistically insert into every specs cache that could plausibly
      // show it — "all folders" and the specific folder / unfiled slot.
      qc.getQueryCache()
        .findAll({ queryKey: ["specs", selectedOrg] })
        .forEach((entry) => {
          const key = entry.queryKey;
          const filter = key[2] as { folderId?: SpecFolderFilter; includeArchived?: boolean };
          const belongs =
            filter.folderId === undefined ||
            filter.folderId === "all" ||
            (filter.folderId === "unfiled" && optimistic.folderId === null) ||
            (typeof filter.folderId === "number" && filter.folderId === optimistic.folderId);
          if (!belongs) return;
          const data = entry.state.data as Spec[] | undefined;
          qc.setQueryData<Spec[]>(key, data ? [optimistic, ...data] : [optimistic]);
        });
      return { tempId };
    },
    onSuccess: (newSpec, _input, context) => {
      qc.getQueryCache()
        .findAll({ queryKey: ["specs", selectedOrg] })
        .forEach((entry) => {
          const data = entry.state.data as Spec[] | undefined;
          if (!data) return;
          if (data.some((s) => s.id === context?.tempId)) {
            qc.setQueryData<Spec[]>(
              entry.queryKey,
              data.map((s) => (s.id === context?.tempId ? newSpec : s)),
            );
          }
        });
      // Bump folder counts.
      qc.invalidateQueries({ queryKey: ["specFolders", selectedOrg] });
    },
    onError: (_err, _input, context) => {
      qc.getQueryCache()
        .findAll({ queryKey: ["specs", selectedOrg] })
        .forEach((entry) => {
          const data = entry.state.data as Spec[] | undefined;
          if (!data) return;
          qc.setQueryData<Spec[]>(
            entry.queryKey,
            data.filter((s) => s.id !== context?.tempId),
          );
        });
    },
  });
}

export function useUpdateSpec() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      id: number;
      title?: string;
      description?: string;
      folderId?: number | null;
      links?: SpecLink[];
    }) =>
      updateSpec(args.id, {
        title: args.title,
        description: args.description,
        folderId: args.folderId,
        links: args.links,
      }),
    onMutate: async (args) => {
      await qc.cancelQueries({ queryKey: ["specs", selectedOrg] });
      await qc.cancelQueries({ queryKey: specKey(selectedOrg, args.id) });
      const snapshots: { key: readonly unknown[]; prev: unknown }[] = [];
      qc.getQueryCache()
        .findAll({ queryKey: ["specs", selectedOrg] })
        .forEach((entry) => {
          snapshots.push({ key: entry.queryKey, prev: entry.state.data });
          const data = entry.state.data as Spec[] | undefined;
          if (!data) return;
          qc.setQueryData<Spec[]>(
            entry.queryKey,
            data.map((s) => (s.id === args.id ? { ...s, ...withoutUndefined(args) } : s)),
          );
        });
      const singleKey = specKey(selectedOrg, args.id);
      const prevSingle = qc.getQueryData<Spec>(singleKey);
      if (prevSingle) {
        snapshots.push({ key: singleKey, prev: prevSingle });
        qc.setQueryData<Spec>(singleKey, { ...prevSingle, ...withoutUndefined(args) });
      }
      return { snapshots };
    },
    onSuccess: (result) => {
      qc.getQueryCache()
        .findAll({ queryKey: ["specs", selectedOrg] })
        .forEach((entry) => {
          const data = entry.state.data as Spec[] | undefined;
          if (!data) return;
          qc.setQueryData<Spec[]>(
            entry.queryKey,
            data.map((s) => (s.id === result.id ? result : s)),
          );
        });
      qc.setQueryData(specKey(selectedOrg, result.id), result);
      // folderId changes shift spec counts across folders.
      qc.invalidateQueries({ queryKey: ["specFolders", selectedOrg] });
    },
    onError: (_err, _args, context) => {
      if (!context) return;
      for (const s of context.snapshots) {
        if (s.prev !== undefined) qc.setQueryData(s.key, s.prev);
      }
    },
  });
}

export function useSetSpecArchived() {
  const { selectedOrg } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: number; archived: boolean }) =>
      args.archived ? archiveSpec(args.id) : unarchiveSpec(args.id),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["specs", selectedOrg] });
      qc.invalidateQueries({ queryKey: ["specFolders", selectedOrg] });
      qc.setQueryData<Spec | undefined>(
        specKey(selectedOrg, result.id),
        (old) => (old ? { ...old, archived: result.archived } : old),
      );
    },
  });
}

// Drop `undefined` fields from a patch so the optimistic merge doesn't
// overwrite existing values with undefined. `id` is included in the patch
// object but should never overwrite the spec's id — the caller-supplied id
// always matches, so dropping it isn't necessary, but skipping undefined is.
function withoutUndefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(obj) as (keyof T)[]) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}
