import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, GitPullRequest } from "lucide-react";
import {
  useInfinitePosts,
  useFeedActors,
  useFeedProjects,
  useFeedEvent,
  type FeedMode,
} from "@/hooks/useNoxlink";
import { Spinner } from "@/components/Spinner";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import type { FeedActor, FeedEvent, FeedProject } from "@/lib/noxlink-api";

const PAGE_SIZE = 25;

export function PostsTab() {
  const actors = useFeedActors();
  const projects = useFeedProjects();
  const [actorFilter, setActorFilter] = useState<string>("");
  const [projectFilter, setProjectFilter] = useState<string>("");
  const [mode, setMode] = useState<FeedMode>("post");
  const posts = useInfinitePosts({
    actorId: actorFilter || undefined,
    projectId: projectFilter || undefined,
    pageSize: PAGE_SIZE,
    mode,
  });

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
  const events = useMemo<FeedEvent[]>(
    () => posts.data?.pages.flatMap((p) => p.events) ?? [],
    [posts.data],
  );

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

  const hasFilters = !!(actorFilter || projectFilter);

  return (
    <div className="max-w-3xl mx-auto space-y-4">
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
        {hasFilters && (
          <button
            type="button"
            onClick={() => { setActorFilter(""); setProjectFilter(""); }}
            className="text-xs text-stone-500 hover:text-stone-700 px-2 py-1"
          >
            Clear
          </button>
        )}
        <div className="ml-auto">
          <FeedModeToggle mode={mode} onChange={setMode} />
        </div>
      </div>

      {events.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-xl p-10 text-center text-stone-400">
          {hasFilters
            ? `No ${mode === "post" ? "posts" : mode === "release_notes" ? "release notes" : "PRs"} match the current filters.`
            : mode === "post"
              ? "No posts yet. As people open PRs, push commits, and ship releases, first-person posts will appear here."
              : mode === "release_notes"
                ? "No release notes yet. Structured release notes will appear here as PRs get merged."
                : "No PRs yet. As your team opens PRs, first-person posts will appear here — then move to Posts and Release notes when they merge."}
        </div>
      ) : (
        <>
          {events.map((event) => (
            <PostCard
              key={event.id}
              event={event}
              actor={event.actor_id ? actorById.get(event.actor_id) ?? null : null}
              project={event.project_id ? projectById.get(event.project_id) ?? null : null}
            />
          ))}
          <div className="flex justify-center pt-2 pb-6">
            {posts.hasNextPage ? (
              <button
                type="button"
                onClick={() => posts.fetchNextPage()}
                disabled={posts.isFetchingNextPage}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg border border-stone-200 bg-white text-stone-700 hover:border-stone-300 hover:text-stone-900 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {posts.isFetchingNextPage && <Spinner size="sm" />}
                {posts.isFetchingNextPage ? "Loading…" : "Load more"}
              </button>
            ) : (
              <div className="text-xs text-stone-400">End of feed</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function FeedModeToggle({
  mode,
  onChange,
}: {
  mode: FeedMode;
  onChange: (m: FeedMode) => void;
}) {
  const options: { value: FeedMode; label: string }[] = [
    { value: "pr", label: "PRs" },
    { value: "post", label: "Posts" },
    { value: "release_notes", label: "Release notes" },
  ];
  return (
    <div
      className="inline-flex items-center rounded-lg border border-stone-200 bg-white p-0.5"
      role="tablist"
      aria-label="Feed mode"
    >
      {options.map((opt) => {
        const active = opt.value === mode;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={
              "px-3 py-1.5 text-xs font-medium rounded-md transition-colors " +
              (active
                ? "bg-accent text-white shadow-sm"
                : "text-stone-600 hover:text-stone-900 hover:bg-stone-50")
            }
          >
            {opt.label}
          </button>
        );
      })}
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
      className={`bg-white border border-stone-200 rounded-xl px-6 py-5 ${expandable ? "cursor-pointer hover:border-stone-300 transition-colors" : ""}`}
    >
      <header className="flex items-center gap-3">
        <Avatar actor={actor} label={actorLabel} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="text-[15px] font-semibold text-stone-900 truncate">{actorLabel}</span>
            {projectLabel && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-[11px] font-semibold tracking-wider rounded-full border border-accent/40 text-accent bg-accent/5">
                {isNoxLink && (
                  <img src="/icons/noxlink-logo.svg" alt="" className="w-3 h-3 shrink-0" />
                )}
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
        <span
          className="text-xs text-stone-400 shrink-0"
          title={formatAbsolute(event.created_at)}
        >
          {timeAgo(event.created_at)}
        </span>
      </header>

      <hr className="mt-3 mb-4 border-stone-100" />

      <div className="text-[15px] leading-relaxed text-stone-800 whitespace-pre-wrap break-words">
        {event.summary || "(no summary)"}
      </div>

      {expanded && triggerEventId != null && (
        <PrDetails triggerEventId={triggerEventId} fallbackOrg={event.org} fallbackRepo={event.repo} />
      )}

      {model === "fallback" ? (
        <div
          className="mt-3 inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-medium rounded-full border border-amber-300 bg-amber-50 text-amber-800"
          title="LLM unavailable when this post was generated — showing the raw event summary instead. Re-run Posts Backfill once the LLM is reachable to regenerate."
        >
          <span aria-hidden>⚠</span>
          LLM unavailable — generic summary
        </div>
      ) : model ? (
        <div className="mt-3 text-xs font-mono text-stone-400">{model}</div>
      ) : null}
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
