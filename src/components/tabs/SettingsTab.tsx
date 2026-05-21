import { useState, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useRepos, useOrgMembers, useIsAdmin } from "@/hooks/useGitHub";
import { useSettings, useSaveSettings, usePeople, useSavePeople } from "@/hooks/useConfigRepo";
import { useFeedProjects } from "@/hooks/useNoxlink";
import { backfillProjectPrs } from "@/lib/noxlink-api";
import { backfillFeatureMatches, unlinkAllPRs, type UnlinkAllResult } from "@/lib/pr-links";
import { PeopleManagement } from "@/components/settings/PeopleManagement";
import {
  triggerSyncWithProgress,
  triggerEventsBackfillWithProgress,
  type SyncProgress,
} from "@/lib/github";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Activity, AlertTriangle, Cpu, GitPullRequest, Loader2, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import {
  fetchLlmSettings,
  saveLlmSettings,
  clearLlmSettings,
  type LlmProvider,
  type LlmSettings,
} from "@/lib/llm-settings";

export function SettingsTab() {
  const { user, selectedOrg, logout } = useAuth();
  const { data: repos } = useRepos({ includeAll: true });
  const { data: settings } = useSettings();
  const saveSettings = useSaveSettings();
  const { data: people } = usePeople();
  const savePeople = useSavePeople();
  const { data: orgMembers } = useOrgMembers();
  const isAdmin = useIsAdmin();

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

      {/* Tracked repos */}
      <div className="bg-white rounded-xl border border-stone-200 p-5 space-y-3">
        <h2 className="text-sm font-semibold text-stone-900">
          Tracked Repositories ({repos?.length ?? 0})
        </h2>
        <p className="text-xs text-stone-400">
          All repositories in {selectedOrg} are tracked by default. Mark repos as
          draft to hide their issues from the Issues view.
        </p>
        <div className="grid grid-cols-2 gap-1.5 max-h-60 overflow-y-auto">
          {repos?.map((repo) => {
            const isDraft = settings?.draftRepos?.includes(repo.name) ?? false;
            return (
              <button
                key={repo.id}
                onClick={() => {
                  if (!settings) return;
                  const current = settings.draftRepos ?? [];
                  const next = isDraft
                    ? current.filter((r) => r !== repo.name)
                    : [...current, repo.name];
                  saveSettings.mutate({ ...settings, draftRepos: next });
                }}
                className={`text-xs text-left px-2 py-1 rounded cursor-pointer transition-colors ${
                  isDraft
                    ? "bg-stone-100  text-stone-400  "
                    : "bg-stone-50  text-stone-600  hover:bg-stone-100  "
                }`}
              >
                {repo.name}
                {isDraft && (
                  <span className="ml-1 text-stone-300">(draft)</span>
                )}
                {!isDraft && repo.language && (
                  <span className="text-stone-300 ml-1">({repo.language})</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

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

      {isAdmin && (
        <section className="space-y-3 pt-4 border-t border-stone-200">
          <div className="flex items-center gap-2 px-1">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              Admin tools
            </h2>
            <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-stone-100 text-stone-500">
              admin
            </span>
          </div>
          <LlmSettingsSection />
          <FullResyncSection />
          <ActivityEventsBackfillSection />
          <PostsBackfillSection />
          <FeatureMatchBackfillSection />
          <RecentFailuresSection />
        </section>
      )}
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
      <h2 className="text-sm font-semibold text-stone-900">Full Re-sync</h2>
      <p className="text-xs text-stone-400">
        Re-fetch every historical PR and issue from GitHub, ignoring the
        incremental sync timestamp. Use this to backfill data missed during
        initial setup or after an extended webhook outage.
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

function ActivityEventsBackfillSection() {
  const qc = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);

  async function handleBackfill() {
    setSyncing(true);
    setProgress(null);
    await triggerEventsBackfillWithProgress((p) => setProgress(p));
    setSyncing(false);
    qc.invalidateQueries({ queryKey: ["noxlink", "events"] });
    qc.invalidateQueries({ queryKey: ["noxlink", "actors"] });
  }

  return (
    <div className="bg-white rounded-xl border border-stone-200 p-5 space-y-3">
      <h2 className="text-sm font-semibold text-stone-900">Live Activity Backfill</h2>
      <p className="text-xs text-stone-400">
        Re-derive missing PR, issue, review, release and push events from GitHub
        for every tracked repo (last 30 days). Use this if Live activity on the
        Engineers tab is missing recent activity for a teammate — for example
        after a deploy gap or webhook outage.
      </p>
      <button
        onClick={handleBackfill}
        disabled={syncing}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 disabled:opacity-50 cursor-pointer"
      >
        {syncing ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Activity size={14} />
        )}
        {syncing
          ? progress?.phase === "init"
            ? "Initializing..."
            : progress?.phase === "syncing"
              ? `Backfilling ${progress.repo} (${progress.synced}/${progress.total})`
              : progress?.phase === "done"
                ? "Done!"
                : "Backfilling..."
          : "Backfill activity events"}
      </button>
      {progress?.phase === "done" && !syncing && (
        <p className="text-xs text-green-600">
          Backfilled events across {progress.synced} repositor
          {progress.synced === 1 ? "y" : "ies"}. Refresh the Engineers tab to see results.
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

const PROVIDER_PRESETS: Record<LlmProvider, { label: string; baseUrl: string; modelHint: string }> = {
  "anthropic": {
    label: "Anthropic (Messages API)",
    baseUrl: "https://api.anthropic.com",
    modelHint: "e.g. claude-sonnet-4-6",
  },
  "openai-compatible": {
    label: "OpenAI-compatible",
    baseUrl: "https://api.openai.com",
    modelHint: "e.g. gpt-4o-mini",
  },
};

function LlmSettingsSection() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["llm-settings"],
    queryFn: fetchLlmSettings,
    staleTime: 30_000,
  });

  const [provider, setProvider] = useState<LlmProvider>("anthropic");
  const [baseUrl, setBaseUrl] = useState(PROVIDER_PRESETS.anthropic.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  function applyPreset(next: LlmProvider) {
    setProvider(next);
    setBaseUrl(PROVIDER_PRESETS[next].baseUrl);
  }

  async function handleSave() {
    setError(null);
    setSavedAt(null);
    if (!apiKey.trim()) {
      setError("API key is required.");
      return;
    }
    if (!model.trim()) {
      setError("Model is required.");
      return;
    }
    setBusy(true);
    try {
      await saveLlmSettings({ provider, baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), model: model.trim() });
      setApiKey("");
      setSavedAt(Date.now());
      qc.invalidateQueries({ queryKey: ["llm-settings"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleClear() {
    setError(null);
    setSavedAt(null);
    setBusy(true);
    try {
      await clearLlmSettings();
      setApiKey("");
      qc.invalidateQueries({ queryKey: ["llm-settings"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const configured = (data as LlmSettings | undefined)?.configured === true;

  return (
    <div className="bg-white rounded-xl border border-stone-200 p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Cpu size={14} className="text-stone-500" />
        <h2 className="text-sm font-semibold text-stone-900">AI Provider</h2>
        <button
          onClick={() => refetch()}
          className="ml-auto text-xs text-stone-500 hover:text-stone-700 inline-flex items-center gap-1 cursor-pointer"
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </div>
      <p className="text-xs text-stone-400">
        Bring your own LLM endpoint for narration and PR↔feature matching. Anthropic
        (default Zhipu compat) or any OpenAI-compatible API. We validate your
        config with a tiny live call before saving — if your key, base URL or
        model name is wrong, the save is refused.
      </p>

      {isLoading ? (
        <div className="text-xs text-stone-400 inline-flex items-center gap-2">
          <Loader2 size={12} className="animate-spin" /> Loading…
        </div>
      ) : isError ? (
        <p className="text-xs text-red-500">Failed to load AI provider settings.</p>
      ) : (
        <>
          {configured && data && "provider" in data ? (
            <div className="text-xs bg-stone-50 border border-stone-200 rounded-lg p-3 space-y-1">
              <p className="text-stone-700">
                <span className="font-medium">Active:</span> {data.provider} · {data.model}
              </p>
              <p className="text-stone-500">
                {data.baseUrl} · key {data.keyMask}
              </p>
              {data.updatedAt && (
                <p className="text-stone-400">
                  Updated {new Date(data.updatedAt).toLocaleString()}
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-stone-500">
              No override set — using the default Zhipu key from the server env.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3 pt-1">
            <label className="text-xs text-stone-600 space-y-1">
              <span className="block">Provider</span>
              <select
                value={provider}
                onChange={(e) => applyPreset(e.target.value as LlmProvider)}
                disabled={busy}
                className="w-full px-2 py-1.5 rounded border border-stone-200 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
              >
                {Object.entries(PROVIDER_PRESETS).map(([value, preset]) => (
                  <option key={value} value={value}>{preset.label}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-stone-600 space-y-1">
              <span className="block">Model</span>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={busy}
                placeholder={PROVIDER_PRESETS[provider].modelHint}
                className="w-full px-2 py-1.5 rounded border border-stone-200 bg-white text-xs font-mono focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
              />
            </label>
            <label className="col-span-2 text-xs text-stone-600 space-y-1">
              <span className="block">Base URL</span>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                disabled={busy}
                className="w-full px-2 py-1.5 rounded border border-stone-200 bg-white text-xs font-mono focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
              />
            </label>
            <label className="col-span-2 text-xs text-stone-600 space-y-1">
              <span className="block">API key {configured && <span className="text-stone-400">(write-only — leave blank to keep current)</span>}</span>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={busy}
                placeholder="sk-… / glm-…"
                autoComplete="new-password"
                className="w-full px-2 py-1.5 rounded border border-stone-200 bg-white text-xs font-mono focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
              />
            </label>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={busy}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 disabled:opacity-50 cursor-pointer"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Cpu size={14} />}
              {busy ? "Validating…" : "Save & validate"}
            </button>
            {configured && (
              <button
                onClick={handleClear}
                disabled={busy}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500 text-white text-xs font-medium hover:bg-red-600 disabled:opacity-50 cursor-pointer"
              >
                <Trash2 size={14} /> Clear override
              </button>
            )}
            {savedAt && !error && (
              <span className="text-xs text-green-600">Saved.</span>
            )}
          </div>
          {error && (
            <p className="text-xs text-red-500">{error}</p>
          )}
        </>
      )}
    </div>
  );
}

type OpFailure = {
  id: number;
  op: string;
  delivery_id: string | null;
  error: string;
  occurred_at: string;
};

function RecentFailuresSection() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["op-failures"],
    queryFn: () => apiGet<{ failures: OpFailure[] }>("/api/op-failures?limit=25"),
    staleTime: 30_000,
  });

  const failures = data?.failures ?? [];

  return (
    <div className="bg-white rounded-xl border border-stone-200 p-5 space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-stone-900">Background failures</h2>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="ml-auto text-xs text-stone-500 hover:text-stone-700 inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
        >
          {isFetching ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Refresh
        </button>
      </div>
      <p className="text-xs text-stone-400">
        Errors swallowed by background workers — narration, PR matching, install
        bootstraps, backfills. The webhook still returned 200, but the
        follow-up work failed. Use this when a post never appears or shows the
        generic fallback.
      </p>
      {isLoading ? (
        <div className="text-xs text-stone-400 inline-flex items-center gap-2">
          <Loader2 size={12} className="animate-spin" /> Loading…
        </div>
      ) : isError ? (
        <p className="text-xs text-red-500">Failed to load failures.</p>
      ) : failures.length === 0 ? (
        <p className="text-xs text-stone-400">No recent failures.</p>
      ) : (
        <ul className="divide-y divide-stone-100 text-xs">
          {failures.map((f) => (
            <li key={f.id} className="py-2 space-y-0.5">
              <div className="flex items-center gap-2">
                <AlertTriangle size={12} className="text-amber-500 shrink-0" />
                <span className="font-mono text-stone-700">{f.op}</span>
                {f.delivery_id && (
                  <span className="text-stone-400 truncate">{f.delivery_id}</span>
                )}
                <span className="ml-auto text-stone-400 shrink-0">
                  {new Date(f.occurred_at + "Z").toLocaleString()}
                </span>
              </div>
              <pre className="text-stone-500 whitespace-pre-wrap break-words font-mono text-[11px] leading-tight pl-5">
                {f.error}
              </pre>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
