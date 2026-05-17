import { useState, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useOrgMembers } from "@/hooks/useGitHub";
import { useSettings, useSaveSettings, usePeople, useSavePeople } from "@/hooks/useConfigRepo";
import { useFeedProjects } from "@/hooks/useNoxlink";
import { backfillProjectPrs } from "@/lib/noxlink-api";
import { backfillFeatureMatches, unlinkAllPRs, type UnlinkAllResult } from "@/lib/pr-links";
import { PeopleManagement } from "@/components/settings/PeopleManagement";
import { triggerSyncWithProgress, type SyncProgress } from "@/lib/github";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { GitPullRequest, Loader2, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export function SettingsTab() {
  const { user, selectedOrg, logout } = useAuth();
  const { data: settings } = useSettings();
  const saveSettings = useSaveSettings();
  const { data: people } = usePeople();
  const savePeople = useSavePeople();
  const { data: orgMembers } = useOrgMembers();

  return (
    <div className="max-w-2xl space-y-6">
      {/* Account */}
      <div className="bg-white rounded-xl border border-stone-200 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-stone-900">Account</h2>
        <div className="flex items-center gap-3">
          {user && (
            <img
              src={user.avatar_url}
              alt={user.login}
              className="w-10 h-10 rounded-full"
            />
          )}
          <div>
            <div className="text-sm font-medium text-stone-800">
              {user?.name ?? user?.login}
            </div>
            <div className="text-xs text-stone-400">@{user?.login}</div>
          </div>
        </div>
        <div className="text-xs text-stone-400">
          Organisation: <span className="font-medium text-stone-600">{selectedOrg}</span>
        </div>
        <button
          onClick={logout}
          className="text-xs text-red-500 hover:text-red-700 cursor-pointer"
        >
          Disconnect GitHub
        </button>
      </div>

      {/* People */}
      {settings && (
        <PeopleManagement
          people={people ?? []}
          savePeople={savePeople}
          orgMembers={orgMembers ?? []}
          settings={settings}
          saveSettings={saveSettings}
        />
      )}

      {/* GitHub App installation */}
      <div className="bg-white rounded-xl border border-stone-200 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-stone-900">GitHub App</h2>
        <p className="text-xs text-stone-400">
          Unticket runs as a GitHub App. Installing it on <span className="font-medium">{selectedOrg}</span> grants
          per-repo permissions and registers the webhook automatically — no manual setup.
        </p>
        <a
          href="https://github.com/apps/unticket/installations/new"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-xs text-blue-600 hover:text-blue-800 hover:underline"
        >
          Install or manage Unticket on GitHub →
        </a>
      </div>

      {/* Full Re-sync */}
      <FullResyncSection />

      {/* Posts backfill */}
      <PostsBackfillSection />

      {/* Feature-match backfill */}
      <FeatureMatchBackfillSection />

      {/* About */}
      <div className="bg-white rounded-xl border border-stone-200 p-5 space-y-2">
        <h2 className="text-sm font-semibold text-stone-900">About unticket.ai</h2>
        <p className="text-xs text-stone-400">
          AI-powered project management dashboard for GitHub organisations.
          Your token is stored locally and sent securely to our API for GitHub operations.
        </p>
      </div>
    </div>
  );
}

function FullResyncSection() {
  const qc = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);

  async function handleResync() {
    setSyncing(true);
    setProgress(null);
    await triggerSyncWithProgress((p) => setProgress(p), true);
    setSyncing(false);
    // Invalidate all data queries so UI refreshes
    qc.invalidateQueries();
  }

  return (
    <div className="bg-white rounded-xl border border-stone-200 p-5 space-y-3">
      <h2 className="text-sm font-semibold text-stone-900">Data Sync</h2>
      <p className="text-xs text-stone-400">
        Run a full re-sync to fetch all historical PRs and issues from GitHub.
        This ignores the incremental sync timestamp and re-fetches everything.
        Use this to backfill data that was missed during initial setup.
      </p>
      <button
        onClick={handleResync}
        disabled={syncing}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 disabled:opacity-50 cursor-pointer"
      >
        {syncing ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <RefreshCw size={14} />
        )}
        {syncing
          ? progress?.phase === "init"
            ? "Initializing..."
            : progress?.phase === "syncing"
              ? `Syncing ${progress.repo} (${progress.synced}/${progress.total})`
              : progress?.phase === "done"
                ? "Done!"
                : "Syncing..."
          : "Full Re-sync"}
      </button>
      {progress?.phase === "done" && !syncing && (
        <p className="text-xs text-green-600">
          Re-synced {progress.synced} repositories. Data refreshed.
        </p>
      )}
      {progress?.phase === "error" && !syncing && (
        <p className="text-xs text-red-500">{progress.error}</p>
      )}
    </div>
  );
}

function PostsBackfillSection() {
  const qc = useQueryClient();
  const { data: projects } = useFeedProjects();
  const activeProjects = useMemo(
    () => (projects ?? []).filter((p) => !p.archived && p.org && p.repo),
    [projects],
  );

  const [running, setRunning] = useState(false);
  const [days, setDays] = useState(3);
  const [progress, setProgress] = useState<{ done: number; total: number; current: string | null }>({
    done: 0,
    total: 0,
    current: null,
  });
  const [result, setResult] = useState<{ queued: number; found: number; renarrated: number; errors: string[] } | null>(null);

  async function handleBackfillAll() {
    if (activeProjects.length === 0) return;
    setRunning(true);
    setResult(null);
    setProgress({ done: 0, total: activeProjects.length, current: null });

    let queuedTotal = 0;
    let foundTotal = 0;
    let renarratedTotal = 0;
    const errors: string[] = [];

    for (let i = 0; i < activeProjects.length; i++) {
      const p = activeProjects[i];
      setProgress({ done: i, total: activeProjects.length, current: p.repo });
      try {
        const res = await backfillProjectPrs(p.id, days);
        queuedTotal += res.queued ?? 0;
        foundTotal += res.found ?? 0;
        renarratedTotal += res.renarrated ?? 0;
      } catch (err) {
        errors.push(`${p.repo}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    setProgress({ done: activeProjects.length, total: activeProjects.length, current: null });
    setResult({ queued: queuedTotal, found: foundTotal, renarrated: renarratedTotal, errors });
    setRunning(false);
    qc.invalidateQueries({ queryKey: ["noxlink", "events"] });
  }

  return (
    <div className="bg-white rounded-xl border border-stone-200 p-5 space-y-3">
      <h2 className="text-sm font-semibold text-stone-900">Posts Backfill</h2>
      <p className="text-xs text-stone-400">
        Generate first-person Posts for recently merged PRs across every active
        repo. Idempotent — already-backfilled PRs are skipped.
      </p>
      <div className="flex items-center gap-3">
        <label className="text-xs text-stone-600 flex items-center gap-2">
          Days:
          <input
            type="number"
            min={1}
            max={30}
            value={days}
            onChange={(e) => setDays(Math.max(1, Math.min(30, Number(e.target.value) || 3)))}
            disabled={running}
            className="w-16 px-2 py-1 rounded border border-stone-200 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent disabled:opacity-50"
          />
        </label>
        <button
          onClick={handleBackfillAll}
          disabled={running || activeProjects.length === 0}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 disabled:opacity-50 cursor-pointer"
        >
          {running ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {running
            ? `Backfilling ${progress.current ?? ""} (${progress.done}/${progress.total})`
            : `Backfill all ${activeProjects.length} active repo${activeProjects.length === 1 ? "" : "s"}`}
        </button>
      </div>
      {result && !running && (
        <div className="text-xs space-y-1">
          <p className="text-green-600">
            Queued {result.queued} new post{result.queued === 1 ? "" : "s"} from {result.found} PR{result.found === 1 ? "" : "s"} found
            {result.renarrated > 0 && `, re-narrated ${result.renarrated} fallback post${result.renarrated === 1 ? "" : "s"}`}.
          </p>
          {result.errors.length > 0 && (
            <div className="text-red-500 space-y-0.5">
              {result.errors.map((e, i) => (
                <p key={i}>{e}</p>
              ))}
            </div>
          )}
          <p className="text-stone-400">
            Narrative cards stream in as Zhipu finishes each PR — refresh the Posts tab in a few seconds.
          </p>
        </div>
      )}
    </div>
  );
}

function FeatureMatchBackfillSection() {
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  const [days, setDays] = useState(14);
  const [force, setForce] = useState(false);
  const [result, setResult] = useState<{
    scanned: number;
    queued: number;
    repos?: number;
    reposInTable?: number;
    prsSeen?: number;
    prsLinked?: number;
    errors?: string[];
    capped?: boolean;
    error?: string;
  } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [unlinkResult, setUnlinkResult] = useState<
    (UnlinkAllResult & { error?: string }) | null
  >(null);

  async function handleUnlinkAll() {
    setConfirmOpen(false);
    setUnlinking(true);
    setUnlinkResult(null);
    try {
      const res = await unlinkAllPRs();
      setUnlinkResult(res);
      qc.invalidateQueries({ queryKey: ["features"] });
      qc.invalidateQueries({ queryKey: ["linkedPRs"] });
      qc.invalidateQueries({ queryKey: ["linkedFeatures"] });
    } catch (err) {
      setUnlinkResult({
        ok: false,
        featuresAffected: 0,
        featuresCleared: 0,
        linksDeleted: 0,
        attemptsCleared: 0,
        errors: [],
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setUnlinking(false);
    }
  }

  async function handleRun() {
    setRunning(true);
    setResult(null);
    try {
      const res = await backfillFeatureMatches(days, force);
      setResult({
        scanned: res.scanned,
        queued: res.queued,
        repos: res.repos,
        reposInTable: res.reposInTable,
        prsSeen: res.prsSeen,
        prsLinked: res.prsLinked,
        errors: res.errors,
        capped: res.capped,
      });
      qc.invalidateQueries({ queryKey: ["features"] });
      qc.invalidateQueries({ queryKey: ["linkedPRs"] });
      qc.invalidateQueries({ queryKey: ["linkedFeatures"] });
    } catch (err) {
      setResult({
        scanned: 0,
        queued: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-stone-200 p-5 space-y-3">
      <h2 className="text-sm font-semibold text-stone-900">PR → Feature Backfill</h2>
      <p className="text-xs text-stone-400">
        Sweep recent PRs across every active repo and ask the LLM to match any
        that aren't linked to a feature yet. Each PR is checked at most once
        per week; toggle "Force" to bypass that cache after you've added new
        features.
      </p>
      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-xs text-stone-600 flex items-center gap-2">
          Days:
          <input
            type="number"
            min={1}
            max={30}
            value={days}
            onChange={(e) =>
              setDays(Math.max(1, Math.min(30, Number(e.target.value) || 14)))
            }
            disabled={running}
            className="w-16 px-2 py-1 rounded border border-stone-200 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent disabled:opacity-50"
          />
        </label>
        <label className="text-xs text-stone-600 flex items-center gap-2">
          <input
            type="checkbox"
            checked={force}
            onChange={(e) => setForce(e.target.checked)}
            disabled={running}
          />
          Force re-check
        </label>
        <button
          onClick={handleRun}
          disabled={running}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 disabled:opacity-50 cursor-pointer"
        >
          {running ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <GitPullRequest size={14} />
          )}
          {running ? "Scanning..." : "Run backfill"}
        </button>
      </div>
      {result && !running && (
        <div className="text-xs space-y-1">
          {result.error ? (
            <p className="text-red-500">{result.error}</p>
          ) : (
            <>
              <p className={result.queued > 0 ? "text-green-600" : "text-stone-600"}>
                Scanned {result.repos ?? 0} active repo{result.repos === 1 ? "" : "s"}
                {typeof result.reposInTable === "number" &&
                  result.reposInTable !== result.repos &&
                  ` (of ${result.reposInTable} in D1)`}
                , saw {result.prsSeen ?? 0} PR{result.prsSeen === 1 ? "" : "s"} in the last {days} days
                {typeof result.prsLinked === "number" && result.prsLinked > 0 &&
                  ` (${result.prsLinked} already linked)`}
                . Queued {result.queued} for matching
                {result.capped && " (capped at 50 — run again for more)"}.
              </p>
              {result.errors && result.errors.length > 0 && (
                <div className="text-red-500 space-y-0.5">
                  {result.errors.map((e, i) => (
                    <p key={i}>{e}</p>
                  ))}
                </div>
              )}
              {result.queued > 0 && (
                <p className="text-stone-400">
                  Links appear on feature cards as the LLM finishes each PR — refresh in a few seconds.
                </p>
              )}
            </>
          )}
        </div>
      )}

      <div className="pt-4 border-t border-stone-200 space-y-3">
        <div>
          <h3 className="text-xs font-semibold text-red-600 uppercase tracking-wide">Danger zone</h3>
          <p className="text-xs text-stone-400 mt-1">
            Remove every PR↔feature link across the org. Clears
            <code className="px-1 py-0.5 bg-stone-100 rounded mx-1">linkedPRs</code>
            from every feature issue body, wipes the link table, and resets the
            matcher's PR cache so the next backfill re-checks every PR. There is
            no undo — links you added manually will be gone too.
          </p>
        </div>
        <button
          onClick={() => setConfirmOpen(true)}
          disabled={unlinking || running}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500 text-white text-xs font-medium hover:bg-red-600 disabled:opacity-50 cursor-pointer"
        >
          {unlinking ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
          {unlinking ? "Unlinking..." : "Unlink all PRs"}
        </button>
        {unlinkResult && !unlinking && (
          <div className="text-xs space-y-1">
            {unlinkResult.error ? (
              <p className="text-red-500">{unlinkResult.error}</p>
            ) : (
              <>
                <p className="text-stone-600">
                  Cleared {unlinkResult.featuresCleared}/{unlinkResult.featuresAffected} feature
                  {unlinkResult.featuresAffected === 1 ? "" : "s"}, deleted{" "}
                  {unlinkResult.linksDeleted} link
                  {unlinkResult.linksDeleted === 1 ? "" : "s"} and{" "}
                  {unlinkResult.attemptsCleared} cached match attempt
                  {unlinkResult.attemptsCleared === 1 ? "" : "s"}.
                </p>
                {unlinkResult.errors.length > 0 && (
                  <div className="text-red-500 space-y-0.5">
                    {unlinkResult.errors.map((e, i) => (
                      <p key={i}>{e}</p>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        variant="danger"
        title="Unlink every PR from every feature?"
        message="This wipes every PR↔feature link in the org — including ones you added manually — and resets the matcher's cache. There is no undo. Re-run the backfill afterwards to rebuild matches."
        confirmLabel="Unlink all"
        onConfirm={handleUnlinkAll}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

