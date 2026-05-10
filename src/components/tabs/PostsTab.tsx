import { useMemo } from "react";
import { usePosts, useFeedActors, useFeedProjects } from "@/hooks/useNoxlink";
import { Spinner } from "@/components/Spinner";
import type { FeedActor, FeedEvent, FeedProject } from "@/lib/noxlink-api";

export function PostsTab() {
  const posts = usePosts(50);
  const actors = useFeedActors();
  const projects = useFeedProjects();

  const actorById = useMemo(() => {
    const m = new Map<string, FeedActor>();
    for (const a of actors.data ?? []) m.set(a.id, a);
    return m;
  }, [actors.data]);

  const projectById = useMemo(() => {
    const m = new Map<string, FeedProject>();
    for (const p of projects.data ?? []) m.set(p.id, p);
    return m;
  }, [projects.data]);

  if (posts.isLoading || actors.isLoading || projects.isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="w-6 h-6 text-accent" />
      </div>
    );
  }

  if (posts.isError) {
    return (
      <div className="text-center py-20 text-stone-400">
        Failed to load feed.
      </div>
    );
  }

  const events = posts.data ?? [];
  if (events.length === 0) {
    return (
      <div className="bg-white border border-stone-200 rounded-xl p-10 text-center text-stone-400">
        No posts yet. As people open PRs, push commits, and ship releases, first-person posts will appear here.
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {events.map((event) => (
        <PostCard
          key={event.id}
          event={event}
          actor={event.actor_id ? actorById.get(event.actor_id) ?? null : null}
          project={event.project_id ? projectById.get(event.project_id) ?? null : null}
        />
      ))}
    </div>
  );
}

interface PostCardProps {
  event: FeedEvent;
  actor: FeedActor | null;
  project: FeedProject | null;
}

function PostCard({ event, actor, project }: PostCardProps) {
  const meta = parsePayload(event.payload_json);
  const actorLabel = actor?.name || actor?.github_login || event.actor_id || "unknown";
  const projectLabel = (project?.slug || project?.name || event.project_id || "").toUpperCase();
  const trigger = formatTrigger(typeof meta.trigger_type === "string" ? meta.trigger_type : null);
  const model = typeof meta.model === "string" ? meta.model : null;

  return (
    <article className="bg-white border border-stone-200 rounded-xl px-6 py-5">
      <header className="flex items-center gap-3">
        <Avatar actor={actor} label={actorLabel} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="text-[15px] font-semibold text-stone-900 truncate">{actorLabel}</span>
            {projectLabel && (
              <span className="inline-flex items-center px-2.5 py-0.5 text-[11px] font-semibold tracking-wider rounded-full border border-accent/40 text-accent bg-accent/5">
                {projectLabel}
              </span>
            )}
            {trigger && (
              <span className="inline-flex items-center px-2.5 py-0.5 text-[11px] font-mono rounded-full border border-stone-200 text-stone-500 bg-stone-50">
                {trigger}
              </span>
            )}
          </div>
        </div>
        <span className="text-xs text-stone-400 shrink-0" title={event.created_at}>
          {timeAgo(event.created_at)}
        </span>
      </header>

      <hr className="mt-3 mb-4 border-stone-100" />

      <div className="text-[15px] leading-relaxed text-stone-800 whitespace-pre-wrap break-words">
        {event.summary || "(no summary)"}
      </div>

      {model && (
        <div className="mt-3 text-xs font-mono text-stone-400">{model}</div>
      )}
    </article>
  );
}

function Avatar({ actor, label }: { actor: FeedActor | null; label: string }) {
  if (actor?.avatar_url) {
    return <img src={actor.avatar_url} alt={label} loading="lazy" className="w-10 h-10 rounded-full shrink-0" />;
  }
  return (
    <div className="w-10 h-10 rounded-full bg-stone-200 shrink-0 flex items-center justify-center text-base font-bold text-stone-500">
      {(label || "?").charAt(0).toUpperCase()}
    </div>
  );
}

function parsePayload(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function formatTrigger(trigger: string | null): string | null {
  if (!trigger) return null;
  return trigger.startsWith("github:") ? trigger.slice("github:".length) : trigger;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso.replace(" ", "T") + (iso.endsWith("Z") ? "" : "Z"));
  if (!Number.isFinite(t)) return iso;
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(t).toLocaleDateString();
}
