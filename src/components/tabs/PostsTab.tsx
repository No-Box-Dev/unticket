import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, GitPullRequest } from "lucide-react";
import { usePosts, useFeedActors, useFeedProjects, useFeedEvent } from "@/hooks/useNoxlink";
import { Spinner } from "@/components/Spinner";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { cn } from "@/lib/cn";
import type { FeedActor, FeedEvent, FeedProject } from "@/lib/noxlink-api";

export function PostsTab() {
  const posts = usePosts(50);
  const actors = useFeedActors();
  const projects = useFeedProjects();
  const [actorFilter, setActorFilter] = useState<string>("");
  const [projectFilter, setProjectFilter] = useState<string>("");

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

  // Dropdowns list every known person/repo, not just those with posts in the
  // current window — so a teammate who hasn't shipped yet is still selectable
  // (and you can confirm "yep, nothing from them yet" via the empty state).
  const events = posts.data ?? [];

  const actorOptions = useMemo(() => {
    const opts = (actors.data ?? [])
      .map((a) => ({ value: a.id, label: a.name || a.github_login || a.id }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return [{ value: "", label: "All people" }, ...opts];
  }, [actors.data]);

  const projectOptions = useMemo(() => {
    const opts = (projects.data ?? [])
      .filter((p) => !p.archived)
      .map((p) => ({ value: p.id, label: p.slug || p.name || p.id }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return [{ value: "", label: "All repos" }, ...opts];
  }, [projects.data]);

  const filteredEvents = useMemo(() => {
    if (!actorFilter && !projectFilter) return events;
    return events.filter((e) => {
      if (actorFilter && e.actor_id !== actorFilter) return false;
      if (projectFilter && e.project_id !== projectFilter) return false;
      return true;
    });
  }, [events, actorFilter, projectFilter]);

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

  return (
    <div className="max-w-2xl mx-auto space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchableSelect
          value={actorFilter}
          onChange={setActorFilter}
          options={actorOptions}
          placeholder="All people"
          className="min-w-[160px]"
        />
        <SearchableSelect
          value={projectFilter}
          onChange={setProjectFilter}
          options={projectOptions}
          placeholder="All repos"
          className="min-w-[160px]"
        />
        {(actorFilter || projectFilter) && (
          <button
            type="button"
            onClick={() => { setActorFilter(""); setProjectFilter(""); }}
            className="text-xs text-stone-500 hover:text-stone-700 px-2 py-1"
          >
            Clear
          </button>
        )}
      </div>

      {events.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-xl p-10 text-center text-stone-400">
          No posts yet. As people open PRs, push commits, and ship releases, first-person posts will appear here.
        </div>
      ) : filteredEvents.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-xl p-10 text-center text-stone-400">
          No posts match the current filters.
        </div>
      ) : (
        filteredEvents.map((event) => (
          <PostCard
            key={event.id}
            event={event}
            actor={event.actor_id ? actorById.get(event.actor_id) ?? null : null}
            project={event.project_id ? projectById.get(event.project_id) ?? null : null}
          />
        ))
      )}
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
  const projectKey = (project?.repo || project?.slug || project?.name || "").toLowerCase();
  const isNoxLink = projectKey === "noxlink";
  const projectLabel = isNoxLink
    ? "NoxLink"
    : (project?.slug || project?.name || event.project_id || "").toUpperCase();
  const trigger = formatTrigger(typeof meta.trigger_type === "string" ? meta.trigger_type : null);
  const model = typeof meta.model === "string" ? meta.model : null;
  const triggerEventId = typeof meta.trigger_event_id === "number" ? meta.trigger_event_id : null;
  const [expanded, setExpanded] = useState(false);
  const expandable = triggerEventId != null;

  return (
    <article
      onClick={expandable ? () => setExpanded((v) => !v) : undefined}
      className={`bg-white border border-stone-200 rounded-xl p-4 ${expandable ? "cursor-pointer hover:border-stone-300 transition-colors" : ""}`}
    >
      <header className="flex items-start gap-3">
        <Avatar actor={actor} label={actorLabel} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-stone-900 truncate">{actorLabel}</span>
            {projectLabel && (
              <span
                className={cn(
                  "text-[10px] font-mono tracking-wide bg-stone-100 text-stone-600 px-1.5 py-0.5 rounded inline-flex items-center gap-1",
                  isNoxLink ? "" : "uppercase",
                )}
              >
                {isNoxLink && (
                  <img src="/icons/noxlink-logo.svg" alt="" className="w-3 h-3 shrink-0" />
                )}
                {projectLabel}
              </span>
            )}
            {trigger && (
              <span className="text-[10px] font-mono uppercase tracking-wide bg-accent/10 text-accent px-1.5 py-0.5 rounded">
                {trigger}
              </span>
            )}
          </div>
          {actor?.github_login && (
            <div className="text-xs text-stone-400 truncate">@{actor.github_login}</div>
          )}
        </div>
        <span
          className="text-xs text-stone-400 shrink-0"
          title={formatAbsolute(event.created_at)}
        >
          {timeAgo(event.created_at)}
        </span>
      </header>

      <div className="mt-3 text-sm text-stone-700 whitespace-pre-wrap break-words">
        {event.summary || "(no summary)"}
      </div>

      {expanded && triggerEventId != null && (
        <PrDetails triggerEventId={triggerEventId} fallbackOrg={event.org} fallbackRepo={event.repo} />
      )}

      {model && (
        <div className="mt-3 text-[10px] font-mono text-stone-400">{model}</div>
      )}
    </article>
  );
}

function PrDetails({
  triggerEventId,
  fallbackOrg,
  fallbackRepo,
}: {
  triggerEventId: number;
  fallbackOrg: string | null;
  fallbackRepo: string | null;
}) {
  const trigger = useFeedEvent(triggerEventId, true);

  if (trigger.isLoading) {
    return (
      <div className="mt-3 border-t border-stone-100 pt-3 text-xs text-stone-400">
        Loading PR…
      </div>
    );
  }
  if (trigger.isError || !trigger.data) {
    return (
      <div className="mt-3 border-t border-stone-100 pt-3 text-xs text-stone-400">
        PR details unavailable.
      </div>
    );
  }

  const payload = parsePayload(trigger.data.payload_json);
  const pr = (payload.pr && typeof payload.pr === "object") ? (payload.pr as Record<string, unknown>) : {};
  const number = typeof pr.number === "number" ? pr.number : null;
  const title = typeof pr.title === "string" ? pr.title : null;
  const body = typeof pr.body === "string" ? pr.body.trim() : "";
  const org = trigger.data.org ?? fallbackOrg;
  const repo = trigger.data.repo ?? fallbackRepo;
  const ghUrl = org && repo && number ? `https://github.com/${org}/${repo}/pull/${number}` : null;

  return (
    <div className="mt-3 border-t border-stone-100 pt-3 space-y-2" onClick={(e) => e.stopPropagation()}>
      {title && (
        <div className="text-xs font-medium text-stone-600">
          {number != null ? `#${number} · ` : ""}{title}
        </div>
      )}
      {body ? (
        <div className="text-xs text-stone-600 whitespace-pre-wrap break-words">
          {body}
        </div>
      ) : (
        <div className="text-xs text-stone-400 italic">No PR description.</div>
      )}
      <div className="flex items-center gap-3">
        {repo && number != null && (
          <Link
            to={`/prs/${repo}/${number}`}
            className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
          >
            <GitPullRequest className="w-3 h-3" />
            View PR
          </Link>
        )}
        {ghUrl && (
          <a
            href={ghUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-stone-500 hover:text-stone-800"
          >
            <ExternalLink className="w-3 h-3" />
            View on GitHub
          </a>
        )}
      </div>
    </div>
  );
}

function Avatar({ actor, label }: { actor: FeedActor | null; label: string }) {
  if (actor?.avatar_url) {
    return <img src={actor.avatar_url} alt={label} loading="lazy" className="w-9 h-9 rounded-full shrink-0" />;
  }
  return (
    <div className="w-9 h-9 rounded-full bg-stone-200 shrink-0 flex items-center justify-center text-sm font-bold text-stone-500">
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

// Bluesky-style compact relative time. Recent posts show s/m/h/d (no "ago"
// suffix), older than a week switches to "Mon DD" same-year, "Mon DD, YYYY"
// older. Full timestamp ("Jul 3, 2023 at 11:11 AM") is on the tooltip.
function timeAgo(iso: string | null): string {
  const t = parseTimestamp(iso);
  if (t == null) return iso ?? "";
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d`;
  const date = new Date(t);
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

function formatAbsolute(iso: string | null): string {
  const t = parseTimestamp(iso);
  if (t == null) return iso ?? "";
  const date = new Date(t);
  const datePart = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timePart = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${datePart} at ${timePart}`;
}

function parseTimestamp(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso.replace(" ", "T") + (iso.endsWith("Z") ? "" : "Z"));
  return Number.isFinite(t) ? t : null;
}
