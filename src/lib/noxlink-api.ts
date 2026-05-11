import { apiGet, apiPatch, apiPost, apiDelete } from "./api";

export interface FeedActor {
  id: string;
  github_login: string | null;
  github_user_id: string | null;
  name: string;
  avatar_url: string | null;
  tone: string | null;
  kind: "human" | "bot" | string;
  owner_id: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface FeedProject {
  id: string;
  name: string;
  slug: string | null;
  org: string | null;
  repo: string | null;
  description: string | null;
  narrator_enabled: 0 | 1;
  archived: 0 | 1;
  archived_at: string | null;
  updated_at: string | null;
}

export interface FeedEvent {
  id: number;
  delivery_id: string | null;
  source: string | null;
  type: string;
  actor_id: string | null;
  project_id: string | null;
  org: string | null;
  repo: string | null;
  summary: string | null;
  payload_json: string | null;
  created_at: string;
}

export const fetchActors = () =>
  apiGet<{ actors: FeedActor[] }>("/api/actors").then((r) => r.actors);

export const fetchActor = (id: string) =>
  apiGet<{ actor: FeedActor }>(`/api/actors/${encodeURIComponent(id)}`).then((r) => r.actor);

export const patchActor = (id: string, fields: Partial<Pick<FeedActor, "name" | "avatar_url" | "tone" | "kind" | "github_user_id">>) =>
  apiPatch<{ actor: FeedActor }>(`/api/actors/${encodeURIComponent(id)}`, fields).then((r) => r.actor);

export const fetchProjects = () =>
  apiGet<{ projects: FeedProject[] }>("/api/projects").then((r) => r.projects);

export interface BackfillResult {
  ok: boolean;
  found: number;
  queued: number;
  skipped: number;
  days: number;
  message?: string;
}

export const backfillProjectPrs = (id: string, days = 3) =>
  apiPost<BackfillResult>(
    `/api/projects/${encodeURIComponent(id)}/backfill-prs`,
    { days },
  );

export const archiveProject = (id: string) =>
  apiPost<{ ok: true; id: string; archived: boolean }>(
    `/api/projects/${encodeURIComponent(id)}/archive`,
    {},
  );

export const unarchiveProject = (id: string) =>
  apiDelete<{ ok: true; id: string; archived: boolean }>(
    `/api/projects/${encodeURIComponent(id)}/archive`,
  );

export interface EventQuery {
  type?: string;
  limit?: number;
  before?: number;
  projectId?: string;
  actorId?: string;
  triggerTypes?: string[];
}

export const fetchEvents = (q: EventQuery = {}) => {
  const params = new URLSearchParams();
  if (q.type) params.set("type", q.type);
  if (q.limit) params.set("limit", String(q.limit));
  if (q.before) params.set("before", String(q.before));
  if (q.projectId) params.set("project_id", q.projectId);
  if (q.actorId) params.set("actor_id", q.actorId);
  if (q.triggerTypes?.length) params.set("trigger_types", q.triggerTypes.join(","));
  const qs = params.toString();
  return apiGet<{ events: FeedEvent[] }>(`/api/events${qs ? `?${qs}` : ""}`).then((r) => r.events);
};

