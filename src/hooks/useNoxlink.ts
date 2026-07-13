import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import {
  fetchActors,
  fetchActor,
  patchActor,
  fetchProjects,
  fetchEvents,
  fetchEventsPage,
  fetchEvent,
  backfillProjectPrs,
  archiveProject,
  unarchiveProject,
  type FeedActor,
  type EventQuery,
} from "@/lib/noxlink-api";

export function useFeedActors() {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["noxlink", "actors", selectedOrg],
    queryFn: fetchActors,
    enabled: !!selectedOrg,
    staleTime: 60_000,
  });
}

export function useFeedActor(id: string | null) {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["noxlink", "actor", selectedOrg, id],
    queryFn: () => fetchActor(id!),
    enabled: !!selectedOrg && !!id,
    staleTime: 30_000,
  });
}

export function useFeedProjects() {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["noxlink", "projects", selectedOrg],
    queryFn: fetchProjects,
    enabled: !!selectedOrg,
    staleTime: 60_000,
  });
}

export function useFeedEvent(id: number | null, enabled = true) {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["noxlink", "event", selectedOrg, id],
    queryFn: () => fetchEvent(id!),
    enabled: !!selectedOrg && id != null && enabled,
    staleTime: 5 * 60_000,
  });
}

export function useFeedEvents(q: EventQuery = {}, opts: { enabled?: boolean } = {}) {
  const { selectedOrg } = useAuth();
  const enabled = (opts.enabled ?? true) && !!selectedOrg;
  return useQuery({
    queryKey: ["noxlink", "events", selectedOrg, q],
    queryFn: () => fetchEvents(q),
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

// Trigger-type filter for merge-time feeds (Posts + Release notes). Keep in
// sync with NARRATABLE_TYPES in functions/lib/narrator.js — the server uses
// it to skip narration entirely so we don't pay tokens for posts we'd hide.
export const POST_TRIGGER_TYPES = ["github:pr:merged"];

// Trigger-type filter for the PRs feed. Rows are written at PR-open time by
// narratePrOpened. Keep in sync with NARRATABLE_TYPES_OPENED in the server.
export const PR_FEED_TRIGGER_TYPES = ["github:pr:opened"];

export function usePosts(limit = 50) {
  return useFeedEvents({ type: "narrative", limit, triggerTypes: POST_TRIGGER_TYPES });
}

export interface PostsFilter {
  actorId?: string;
  projectId?: string;
  pageSize?: number;
}

// "post"           = first-person chat post at merge   (events.type='narrative')
// "release_notes"  = structured/reused release note    (events.type='release_notes')
// "pr"             = first-person post at PR-open time (events.type='pr_narrative')
// The PRs mode uses a different trigger type (github:pr:opened) — all three
// modes route through the same server endpoint via the events.type filter.
export type FeedMode = "post" | "release_notes" | "pr";

const FEED_MODE_TYPE: Record<FeedMode, string> = {
  post: "narrative",
  release_notes: "release_notes",
  pr: "pr_narrative",
};

const FEED_MODE_TRIGGER_TYPES: Record<FeedMode, string[]> = {
  post: POST_TRIGGER_TYPES,
  release_notes: POST_TRIGGER_TYPES,
  pr: PR_FEED_TRIGGER_TYPES,
};

export function useInfinitePosts(filter: PostsFilter & { mode?: FeedMode } = {}) {
  const { selectedOrg } = useAuth();
  const pageSize = filter.pageSize ?? 25;
  const actorId = filter.actorId || undefined;
  const projectId = filter.projectId || undefined;
  const mode: FeedMode = filter.mode ?? "post";
  const eventType = FEED_MODE_TYPE[mode];
  const triggerTypes = FEED_MODE_TRIGGER_TYPES[mode];
  return useInfiniteQuery({
    queryKey: ["noxlink", "posts", selectedOrg, { mode, actorId, projectId, pageSize }],
    queryFn: ({ pageParam }) =>
      fetchEventsPage({
        type: eventType,
        triggerTypes,
        limit: pageSize,
        actorId,
        projectId,
        before: pageParam ?? undefined,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.events.length < pageSize ? undefined : (last.nextCursor ?? undefined),
    enabled: !!selectedOrg,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function usePatchActor() {
  const qc = useQueryClient();
  const { selectedOrg } = useAuth();
  return useMutation({
    mutationFn: ({ id, fields }: { id: string; fields: Partial<Pick<FeedActor, "name" | "avatar_url" | "tone" | "kind" | "github_user_id">> }) =>
      patchActor(id, fields),
    onSuccess: (actor) => {
      qc.setQueryData(["noxlink", "actor", selectedOrg, actor.id], actor);
      qc.invalidateQueries({ queryKey: ["noxlink", "actors", selectedOrg] });
    },
  });
}

export function useBackfillProjectPrs() {
  const qc = useQueryClient();
  const { selectedOrg } = useAuth();
  return useMutation({
    mutationFn: ({ id, days }: { id: string; days?: number }) =>
      backfillProjectPrs(id, days),
    onSuccess: () => {
      // Posts will appear out-of-band via narrateEvent. Invalidate so the
      // Feed picks them up on next refetch.
      qc.invalidateQueries({ queryKey: ["noxlink", "events", selectedOrg] });
    },
  });
}

export function useSetProjectArchived() {
  const qc = useQueryClient();
  const { selectedOrg } = useAuth();
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      archived ? archiveProject(id) : unarchiveProject(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["noxlink", "projects", selectedOrg] });
    },
  });
}
