import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import {
  fetchActors,
  fetchActor,
  patchActor,
  fetchProjects,
  fetchEvents,
  fetchNotes,
  putNote,
  deleteNote,
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

export function useFeedEvents(q: EventQuery = {}) {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["noxlink", "events", selectedOrg, q],
    queryFn: () => fetchEvents(q),
    enabled: !!selectedOrg,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

// Only show narratives that came from a "shipped" event. Keep this list in
// sync with NARRATABLE_TYPES in functions/lib/narrator.js — the server uses
// it to skip narration entirely so we don't pay tokens for posts we'd hide.
export const POST_TRIGGER_TYPES = ["github:pr:merged", "github:issue:closed"];

export function usePosts(limit = 50) {
  return useFeedEvents({ type: "narrative", limit, triggerTypes: POST_TRIGGER_TYPES });
}

export function useActorNotes(actorId: string | null) {
  const { selectedOrg } = useAuth();
  return useQuery({
    queryKey: ["noxlink", "notes", selectedOrg, actorId],
    queryFn: () => fetchNotes({ actorId: actorId! }),
    enabled: !!selectedOrg && !!actorId,
    staleTime: 30_000,
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

export function usePutNote() {
  const qc = useQueryClient();
  const { selectedOrg } = useAuth();
  return useMutation({
    mutationFn: ({ actorId, projectId, note }: { actorId: string; projectId: string; note: string }) =>
      putNote(actorId, projectId, note),
    onSuccess: (_data, { actorId }) => {
      qc.invalidateQueries({ queryKey: ["noxlink", "notes", selectedOrg, actorId] });
    },
  });
}

export function useDeleteNote() {
  const qc = useQueryClient();
  const { selectedOrg } = useAuth();
  return useMutation({
    mutationFn: ({ actorId, projectId }: { actorId: string; projectId: string }) =>
      deleteNote(actorId, projectId),
    onSuccess: (_data, { actorId }) => {
      qc.invalidateQueries({ queryKey: ["noxlink", "notes", selectedOrg, actorId] });
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
