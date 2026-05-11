import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useFeedProjects,
  useBackfillProjectPrs,
  useSetProjectArchived,
} from "@/hooks/useNoxlink";
import { backfillProjectPrs } from "@/lib/noxlink-api";
import { useAuth } from "@/lib/auth";
import { Spinner } from "@/components/Spinner";
import { cn } from "@/lib/cn";
import { Archive, ArchiveRestore, ExternalLink, Sparkles, Loader2 } from "lucide-react";
import type { FeedProject, BackfillResult } from "@/lib/noxlink-api";

export function ReposTab() {
  const projects = useFeedProjects();
  const [showArchived, setShowArchived] = useState(false);

  if (projects.isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="w-6 h-6 text-accent" />
      </div>
    );
  }

  if (projects.isError) {
    return <div className="text-center py-20 text-stone-400">Failed to load repos.</div>;
  }

  const list = projects.data ?? [];
  if (list.length === 0) {
    return (
      <div className="bg-white border border-stone-200 rounded-xl p-10 text-center text-stone-400">
        No repos yet. Make sure the GitHub App is installed; repos populate from the install on first load.
      </div>
    );
  }

  const active = list.filter((p) => !p.archived).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  const archived = list.filter((p) => !!p.archived).sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  return (
    <div className="max-w-3xl mx-auto space-y-2">
      <header className="flex items-center justify-between gap-3 px-1">
        <div className="flex items-baseline gap-3">
          <h2 className="text-lg font-semibold text-stone-900 font-display">Repos</h2>
          <span className="text-xs text-stone-500">
            {active.length} active{archived.length > 0 ? ` · ${archived.length} archived` : ""}
          </span>
        </div>
        <BackfillAllButton activeProjects={active} />
      </header>

      <div className="space-y-2">
        {active.map((p) => (
          <RepoRow key={p.id} project={p} />
        ))}
      </div>

      {archived.length > 0 && (
        <div className="pt-4">
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="text-xs text-stone-500 hover:text-stone-800 cursor-pointer px-1"
          >
            {showArchived ? "Hide" : "Show"} archived ({archived.length})
          </button>
          {showArchived && (
            <div className="mt-2 space-y-2">
              {archived.map((p) => (
                <RepoRow key={p.id} project={p} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BackfillAllButton({ activeProjects }: { activeProjects: FeedProject[] }) {
  const qc = useQueryClient();
  const { selectedOrg } = useAuth();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; current: string | null }>({
    done: 0,
    total: 0,
    current: null,
  });
  const [summary, setSummary] = useState<string | null>(null);

  const handleClick = async () => {
    if (activeProjects.length === 0 || running) return;
    setRunning(true);
    setSummary(null);
    setProgress({ done: 0, total: activeProjects.length, current: null });

    let queued = 0;
    let found = 0;
    let errors = 0;

    for (let i = 0; i < activeProjects.length; i++) {
      const p = activeProjects[i];
      setProgress({ done: i, total: activeProjects.length, current: p.repo });
      try {
        const r = await backfillProjectPrs(p.id, 3);
        queued += r.queued ?? 0;
        found += r.found ?? 0;
      } catch {
        errors += 1;
      }
    }

    setProgress({ done: activeProjects.length, total: activeProjects.length, current: null });
    setSummary(
      `Queued ${queued} new post${queued === 1 ? "" : "s"} from ${found} PR${found === 1 ? "" : "s"}${errors ? ` · ${errors} error${errors === 1 ? "" : "s"}` : ""}.`,
    );
    setRunning(false);
    qc.invalidateQueries({ queryKey: ["noxlink", "events", selectedOrg] });
  };

  return (
    <div className="flex items-center gap-3">
      {summary && !running && (
        <span className="text-xs text-stone-500">{summary}</span>
      )}
      <button
        type="button"
        onClick={handleClick}
        disabled={running || activeProjects.length === 0}
        title="Generate posts for the last 3 days of merged PRs across every active repo. Idempotent — already-backfilled PRs are skipped."
        className={cn(
          "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg font-medium transition-colors cursor-pointer",
          running
            ? "bg-stone-100 text-stone-500 cursor-not-allowed"
            : "bg-stone-700 text-white hover:bg-stone-900 disabled:opacity-50",
        )}
      >
        {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
        {running
          ? `${progress.current ?? ""} (${progress.done}/${progress.total})`
          : `Backfill all ${activeProjects.length} repo${activeProjects.length === 1 ? "" : "s"}`}
      </button>
    </div>
  );
}

function RepoRow({ project }: { project: FeedProject }) {
  const backfill = useBackfillProjectPrs();
  const setArchived = useSetProjectArchived();
  const [result, setResult] = useState<BackfillResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const isArchived = !!project.archived;

  const handleBackfill = async () => {
    setResult(null);
    setErr(null);
    try {
      const r = await backfill.mutateAsync({ id: project.id, days: 3 });
      setResult(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Backfill failed");
    }
  };

  const handleArchive = () => {
    setArchived.mutate({ id: project.id, archived: !isArchived });
  };

  const ghUrl = project.org && project.repo
    ? `https://github.com/${project.org}/${project.repo}`
    : null;

  return (
    <div
      className={cn(
        "border rounded-xl p-4 flex items-center gap-3",
        isArchived ? "bg-stone-50 border-stone-200 opacity-70" : "bg-white border-stone-200",
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn("text-sm font-semibold truncate", isArchived ? "text-stone-500" : "text-stone-900")}>
            {project.repo || project.name}
          </span>
          {project.org && (
            <span className="text-xs text-stone-400">{project.org}</span>
          )}
          {isArchived && (
            <span className="text-[10px] font-mono uppercase tracking-wide bg-stone-200 text-stone-600 px-1.5 py-0.5 rounded">
              archived
            </span>
          )}
          {!isArchived && project.narrator_enabled === 0 && (
            <span className="text-[10px] font-mono uppercase tracking-wide bg-stone-100 text-stone-500 px-1.5 py-0.5 rounded">
              narrator off
            </span>
          )}
        </div>
        {project.description && (
          <p className="text-xs text-stone-500 mt-0.5 line-clamp-1">{project.description}</p>
        )}
        <div className="mt-1 text-xs text-stone-400 min-h-[1rem]">
          {result && renderBackfillStatus(result)}
          {err && <span className="text-severity-high">{err}</span>}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {ghUrl && (
          <a
            href={ghUrl}
            target="_blank"
            rel="noreferrer"
            className="p-1.5 rounded-md text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors"
            title={`Open ${project.org}/${project.repo} on GitHub`}
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
        {!isArchived && (
          <button
            type="button"
            onClick={handleBackfill}
            disabled={backfill.isPending}
            title="Generate first-person posts for the last 3 days of PRs (one per PR, attributed to its author)."
            className={cn(
              "px-3 py-1.5 text-xs rounded-lg font-medium transition-colors cursor-pointer",
              backfill.isPending
                ? "bg-stone-100 text-stone-400 cursor-not-allowed"
                : "bg-stone-700 text-white hover:bg-stone-900",
            )}
          >
            {backfill.isPending ? "Backfilling…" : "Backfill 3d"}
          </button>
        )}
        <button
          type="button"
          onClick={handleArchive}
          disabled={setArchived.isPending}
          title={isArchived
            ? "Restore this repo. It will start syncing and appearing in Issues/PRs again."
            : "Archive this repo. It stops syncing and won't appear in Issues/PRs."}
          className={cn(
            "p-1.5 rounded-md transition-colors cursor-pointer",
            setArchived.isPending
              ? "text-stone-300 cursor-not-allowed"
              : "text-stone-400 hover:text-stone-700 hover:bg-stone-100",
          )}
        >
          {isArchived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}

function renderBackfillStatus(r: BackfillResult): string {
  const parts: string[] = [];
  if (r.queued > 0) {
    parts.push(`Queued ${r.queued} PR${r.queued === 1 ? "" : "s"}`);
    if (r.skipped) parts.push(`${r.skipped} already done`);
  }
  if (r.renarrated > 0) {
    parts.push(`re-narrated ${r.renarrated} fallback post${r.renarrated === 1 ? "" : "s"}`);
  }
  if (parts.length === 0) {
    return r.message || `All ${r.found} PRs already backfilled.`;
  }
  return parts.join(" · ") + ". Posts appear in the Feed shortly.";
}
