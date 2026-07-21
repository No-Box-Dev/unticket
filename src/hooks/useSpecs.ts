import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import {
  archiveSpec,
  createSpec,
  fetchSpec,
  fetchSpecs,
  unarchiveSpec,
  updateSpec,
  type SpecFeatureFilter,
} from "@/lib/specs-api";
import type { Spec, SpecLink } from "@/lib/types";

const specsKey = (
  org: string | null,
  filter: { featureNumber?: SpecFeatureFilter; includeArchived?: boolean },
) => ["specs", org, filter] as const;
const specKey = (org: string | null, id: number | null) => ["spec", org, id] as const;

let nextTempSpecId = -1;

export function useSpecs(
  filter: { featureNumber?: SpecFeatureFilter; includeArchived?: boolean } = {},
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
      featureNumber?: number | null;
      links?: SpecLink[];
    }) => createSpec(input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ["specs", selectedOrg] });
      const tempId = nextTempSpecId--;
      const optimistic: Spec = {
        id: tempId,
        featureNumber: input.featureNumber ?? null,
        title: input.title,
        description: input.description ?? "",
        links: input.links ?? [],
        archived: false,
        archivedAt: null,
        createdBy: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      qc.getQueryCache()
        .findAll({ queryKey: ["specs", selectedOrg] })
        .forEach((entry) => {
          const key = entry.queryKey;
          const filter = key[2] as { featureNumber?: SpecFeatureFilter; includeArchived?: boolean };
          const belongs =
            filter.featureNumber === undefined ||
            filter.featureNumber === "all" ||
            (filter.featureNumber === "unfiled" && optimistic.featureNumber === null) ||
            (typeof filter.featureNumber === "number" && filter.featureNumber === optimistic.featureNumber);
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
      featureNumber?: number | null;
      links?: SpecLink[];
    }) =>
      updateSpec(args.id, {
        title: args.title,
        description: args.description,
        featureNumber: args.featureNumber,
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
      qc.setQueryData<Spec | undefined>(
        specKey(selectedOrg, result.id),
        (old) => (old ? { ...old, archived: result.archived } : old),
      );
    },
  });
}

function withoutUndefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(obj) as (keyof T)[]) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}
