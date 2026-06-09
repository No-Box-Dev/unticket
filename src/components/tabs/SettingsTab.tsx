import { useState, useMemo, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useOrgMembers, useIsAdmin, useTriggerFeatureSync } from "@/hooks/useGitHub";
import { useSettings, useSaveSettings, usePeople, useSavePeople } from "@/hooks/useConfigRepo";
import { useFeedProjects } from "@/hooks/useNoxlink";
import { backfillProjectPrs } from "@/lib/noxlink-api";
import { PeopleManagement } from "@/components/settings/PeopleManagement";
import { BoardStagesSection } from "@/components/settings/BoardStagesSection";
import { SyncFromGithubModal } from "@/components/SyncFromGithub";
import {
  triggerSyncWithProgress,
  triggerEventsBackfillWithProgress,
  type SyncProgress,
} from "@/lib/github";
import { Activity, AlertTriangle, Check, Cpu, Loader2, MessageSquare, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiFetch } from "@/lib/api";
import type { OrgSettings } from "@/lib/types";
import {
  fetchLlmSettings,
  saveLlmSettings,
  clearLlmSettings,
  type LlmProvider,
  type LlmSettings,
} from "@/lib/llm-settings";

export function SettingsTab() {
  const { user, selectedOrg, logout, authMode } = useAuth();
  const { data: settings } = useSettings();
  const saveSettings = useSaveSettings();
  const { data: people } = usePeople();
  const savePeople = useSavePeople();
  const { data: orgMembers } = useOrgMembers();
  const isAdmin = useIsAdmin();

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
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

        {/* GitHub App installation */}
        <div className="bg-white rounded-xl border border-stone-200 p-5 space-y-3">
          <h2 className="text-sm font-semibold text-stone-900">GitHub App</h2>
          <p className="text-xs text-stone-400">
            Unticket runs as a GitHub App. Installing it on <span className="font-medium">{selectedOrg}</span> grants
            per-repo permissions and registers the webhook automatically — no manual setup.
          </p>
          {authMode === "pat" && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              You're signed in with a personal access token. Data refreshes only when you
              sync manually — real-time updates need the GitHub App installed and "Sign in
              with GitHub". Install the App below, then sign in with it to enable webhooks.
            </p>
          )}
          <a
            href="https://github.com/apps/unticket/installations/new"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-xs text-blue-600 hover:text-blue-800 hover:underline"
          >
            Install or manage Unticket on GitHub →
          </a>
        </div>
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
          <FeaturesRepoSection />
          <BoardStagesSection />
          <LlmSettingsSection />
          <ReleaseNotesPromptSection />
          <SlackSettingsSection />
          <ManualSyncSection />
          <FullResyncSection />
          <ActivityEventsBackfillSection />
          <PostsBackfillSection />
          <RecentFailuresSection />
        </section>
      )}
    </div>
  );
}

function ManualSyncSection() {
  const syncFeaturesMut = useTriggerFeatureSync();
  const [syncOpen, setSyncOpen] = useState(false);

  return (
    <div className="bg-white rounded-xl border border-stone-200 p-5 space-y-3">
      <h2 className="text-sm font-semibold text-stone-900">Manual sync</h2>
      <p className="text-xs text-stone-400">
        Trigger an on-demand pull from GitHub. Incremental sync also runs automatically
        on webhook events and the 30-minute cron.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => {
            if (syncFeaturesMut.isPending) return;
            syncFeaturesMut.mutate();
          }}
          disabled={syncFeaturesMut.isPending}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-stone-200 bg-white text-stone-700 text-xs font-medium hover:bg-stone-50 disabled:opacity-50 disabled:cursor-wait cursor-pointer"
        >
          {syncFeaturesMut.isPending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Sparkles size={14} />
          )}
          {syncFeaturesMut.isPending ? "Syncing features…" : "Sync features"}
        </button>
        <button
          onClick={() => setSyncOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-stone-200 bg-white text-stone-700 text-xs font-medium hover:bg-stone-50 cursor-pointer"
        >
          <RefreshCw size={14} />
          Sync from GitHub
        </button>
      </div>
      <SyncFromGithubModal open={syncOpen} onClose={() => setSyncOpen(false)} />
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
  const [rewriteOtherModels, setRewriteOtherModels] = useState(false);
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
        const res = await backfillProjectPrs(p.id, days, rewriteOtherModels);
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
      <div className="flex items-center gap-3 flex-wrap">
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
        <label className="text-xs text-stone-600 flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={rewriteOtherModels}
            onChange={(e) => setRewriteOtherModels(e.target.checked)}
            disabled={running}
            className="rounded border-stone-300 text-accent focus:ring-accent/30 disabled:opacity-50"
          />
          Rewrite posts written on a different model
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
            {result.renarrated > 0 && `, re-narrated ${result.renarrated} post${result.renarrated === 1 ? "" : "s"}`}.
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

// UI-only preset id. Maps to the backend wire provider (`LlmProvider`) via
// `wire`. LiteLLM speaks OpenAI's chat-completions shape, so it rides the
// same `openai-compatible` transport — the preset just gives it a labeled
// entry in the dropdown and LiteLLM-flavored placeholders.
type PresetId = "anthropic" | "openai" | "litellm";

const PROVIDER_PRESETS: Record<
  PresetId,
  {
    label: string;
    wire: LlmProvider;
    baseUrl: string;
    modelHint: string;
    apiKeyHint: string;
    hint?: string;
    // Quick-pick suggestions for the Model input. First entry = recommended.
    suggestedModels: string[];
  }
> = {
  "anthropic": {
    label: "Anthropic (Messages API)",
    wire: "anthropic",
    baseUrl: "https://api.anthropic.com",
    modelHint: "e.g. claude-sonnet-4-6",
    apiKeyHint: "sk-ant-…",
    suggestedModels: [
      "claude-haiku-4-5",
      "claude-sonnet-4-6",
      "claude-opus-4-7",
      "glm-5",
    ],
  },
  "openai": {
    label: "OpenAI (chat completions)",
    wire: "openai-compatible",
    baseUrl: "https://api.openai.com",
    modelHint: "e.g. gpt-4o-mini",
    apiKeyHint: "sk-…",
    suggestedModels: [
      "gpt-4o-mini",
      "gpt-4o",
      "gpt-4.1-mini",
      "gpt-4.1",
    ],
  },
  "litellm": {
    label: "LiteLLM proxy",
    wire: "openai-compatible",
    baseUrl: "https://litellm.example.com",
    modelHint: "model alias from your LiteLLM config (e.g. gpt-4o-mini)",
    apiKeyHint: "your LiteLLM virtual or master key",
    hint:
      "Point Base URL at your LiteLLM proxy root (no /v1, no trailing slash). " +
      "Model must match an alias defined in your LiteLLM config.yaml.",
    suggestedModels: [
      "gpt-4o-mini",
      "claude-haiku-4-5",
      "claude-sonnet-4-6",
      "gemini-2.0-flash",
    ],
  },
};

// Derive the UI preset from the stored wire provider + base URL. LiteLLM
// rides on the same openai-compatible wire as OpenAI, so we use the
// hostname as the tie-breaker for the placeholder/hint set.
function derivePreset(provider: LlmProvider, baseUrl: string): PresetId {
  if (provider === "anthropic") return "anthropic";
  return /litellm/i.test(baseUrl) ? "litellm" : "openai";
}

function LlmSettingsSection() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["llm-settings"],
    queryFn: fetchLlmSettings,
    staleTime: 30_000,
  });

  const [preset, setPreset] = useState<PresetId>("anthropic");
  const [baseUrl, setBaseUrl] = useState(PROVIDER_PRESETS.anthropic.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const configured = (data as LlmSettings | undefined)?.configured === true;

  // When the saved config loads (or refetches), seed the form so the inputs
  // *are* the current state — no separate "Active:" panel duplicating the
  // model / base URL.
  useEffect(() => {
    if (data && data.configured) {
      setPreset(derivePreset(data.provider, data.baseUrl));
      setBaseUrl(data.baseUrl);
      setModel(data.model);
    }
  }, [data]);

  function applyPreset(next: PresetId) {
    setPreset(next);
    // Only overwrite baseUrl with the preset default when the user is
    // starting fresh — once a config is saved, we keep their URL untouched
    // on preset changes (they explicitly picked it).
    if (!configured) {
      setBaseUrl(PROVIDER_PRESETS[next].baseUrl);
    }
  }

  async function handleSave() {
    setError(null);
    setSavedAt(null);
    if (!configured && !apiKey.trim()) {
      setError("API key is required.");
      return;
    }
    if (!model.trim()) {
      setError("Model is required.");
      return;
    }
    setBusy(true);
    try {
      await saveLlmSettings({
        provider: PROVIDER_PRESETS[preset].wire,
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        model: model.trim(),
      });
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
        Bring your own LLM endpoint for narration and PR↔feature matching. Pick
        Anthropic (also covers Zhipu's Anthropic-compat endpoint), OpenAI, or a
        LiteLLM proxy — anything that speaks the OpenAI chat-completions shape.
        We validate with a tiny live call before saving — if your key, base URL
        or model name is wrong, the save is refused.
      </p>

      {isLoading ? (
        <div className="text-xs text-stone-400 inline-flex items-center gap-2">
          <Loader2 size={12} className="animate-spin" /> Loading…
        </div>
      ) : isError ? (
        <p className="text-xs text-red-500">Failed to load AI provider settings.</p>
      ) : (
        <>
          {!configured && (
            <p className="text-xs text-stone-500">
              No override set — using the default Zhipu key from the server env.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3 pt-1">
            <label className="text-xs text-stone-600 space-y-1">
              <span className="block">Provider</span>
              <select
                value={preset}
                onChange={(e) => applyPreset(e.target.value as PresetId)}
                disabled={busy}
                className="w-full px-2 py-1.5 rounded border border-stone-200 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
              >
                {Object.entries(PROVIDER_PRESETS).map(([value, p]) => (
                  <option key={value} value={value}>{p.label}</option>
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
                placeholder={PROVIDER_PRESETS[preset].modelHint}
                className="w-full px-2 py-1.5 rounded border border-stone-200 bg-white text-xs font-mono focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
              />
              <div className="flex flex-wrap gap-1.5 pt-1">
                {PROVIDER_PRESETS[preset].suggestedModels.map((m) => {
                  const active = model.trim() === m;
                  const savedActive = configured && data && "model" in data && data.model === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setModel(m)}
                      disabled={busy}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-mono transition-colors cursor-pointer disabled:opacity-50 ${
                        active
                          ? "border-accent bg-accent/10 text-accent"
                          : "border-stone-200 bg-white text-stone-600 hover:border-stone-300"
                      }`}
                      title={savedActive ? `${m} (saved)` : m}
                    >
                      {savedActive && <Check size={10} aria-hidden />}
                      {m}
                    </button>
                  );
                })}
              </div>
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
              {PROVIDER_PRESETS[preset].hint && (
                <span className="block text-stone-400">{PROVIDER_PRESETS[preset].hint}</span>
              )}
            </label>
            <label className="col-span-2 text-xs text-stone-600 space-y-1">
              <span className="block">
                API key
                {configured && data && "keyMask" in data && (
                  <span className="text-stone-400">
                    {" "}— current {data.keyMask}, leave blank to keep it
                  </span>
                )}
              </span>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={busy}
                placeholder={configured ? "leave blank to keep current key" : PROVIDER_PRESETS[preset].apiKeyHint}
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
              {busy ? "Validating…" : configured ? "Save changes" : "Save & validate"}
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

function FeaturesRepoSection() {
  const { selectedOrg } = useAuth();
  const { data: settings } = useSettings();
  const saveSettings = useSaveSettings();
  const persisted = settings?.unticketRepo ?? "";
  const [draftOverride, setDraftOverride] = useState<string | null>(null);
  const draft = draftOverride ?? persisted;
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trimmed = draft.trim();
  const persistedTrimmed = persisted.trim();
  const isDirty = draftOverride !== null && trimmed !== persistedTrimmed;
  const usingDefault = !persistedTrimmed;

  // GitHub repo name rules: letters/digits/hyphen/underscore/period, no
  // spaces, no slashes (org prefix lives elsewhere).
  const valid = trimmed === "" || /^[A-Za-z0-9._-]+$/.test(trimmed);

  async function handleSave() {
    if (!settings) return;
    if (!valid) {
      setError("Repo name can only contain letters, digits, '.', '-', and '_'.");
      return;
    }
    setError(null);
    try {
      const next = { ...settings, unticketRepo: trimmed ? trimmed : undefined };
      await saveSettings.mutateAsync(next);
      setDraftOverride(null);
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleResetToDefault() {
    setDraftOverride("");
  }

  return (
    <div className="bg-white rounded-xl border border-stone-200 p-5 space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-stone-900">Features repo</h2>
        {usingDefault && (
          <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-stone-100 text-stone-500">
            using default
          </span>
        )}
      </div>
      <p className="text-xs text-stone-400">
        Which repo in <span className="font-medium text-stone-600">{selectedOrg}</span> holds
        the feature-tracking issues (label <code className="font-mono text-stone-600">unticket</code> +{" "}
        <code className="font-mono text-stone-600">feature</code>) and where Agent Rules get pushed.
        Leave empty to use the default — <code className="font-mono text-stone-600">unticket</code>.
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex items-center rounded-lg border border-stone-200 bg-stone-50 overflow-hidden">
          <span className="px-2.5 py-1.5 text-xs font-mono text-stone-500 border-r border-stone-200">
            {selectedOrg}/
          </span>
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraftOverride(e.target.value)}
            placeholder="unticket"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="px-2 py-1.5 text-xs font-mono bg-white focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent w-48"
          />
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={!isDirty || !valid || saveSettings.isPending}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 disabled:opacity-50 cursor-pointer"
        >
          {saveSettings.isPending && <Loader2 size={12} className="animate-spin" />}
          Save
        </button>
        <button
          type="button"
          onClick={handleResetToDefault}
          disabled={!draft || saveSettings.isPending}
          className="text-xs text-stone-500 hover:text-stone-700 disabled:opacity-50 cursor-pointer"
        >
          Reset to default
        </button>
        {savedAt && !isDirty && !error && (
          <span className="inline-flex items-center gap-1 text-xs text-green-600">
            <Check size={12} /> Saved
          </span>
        )}
        {error && <span className="text-xs text-red-500">{error}</span>}
      </div>
    </div>
  );
}

function ReleaseNotesPromptSection() {
  const { data: settings } = useSettings();
  const saveSettings = useSaveSettings();
  // `draftOverride` is null while the textarea mirrors the persisted value
  // (the common "haven't edited yet" state), so we don't need an effect to
  // seed draft from settings after the query resolves. As soon as the user
  // types, draftOverride holds the local edit; saving clears it back to null
  // so the field re-syncs to whatever the server returns.
  const persisted = settings?.releaseNotesPrompt ?? "";
  const [draftOverride, setDraftOverride] = useState<string | null>(null);
  const draft = draftOverride ?? persisted;
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isDirty = draftOverride !== null && draftOverride !== persisted;
  const usingDefault = !persisted.trim();

  async function handleSave() {
    if (!settings) return;
    setError(null);
    try {
      const next = { ...settings, releaseNotesPrompt: draft.trim() ? draft : undefined };
      await saveSettings.mutateAsync(next);
      setDraftOverride(null);
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleResetToDefault() {
    setDraftOverride("");
  }

  return (
    <div className="bg-white rounded-xl border border-stone-200 p-5 space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-stone-900">Release notes prompt</h2>
        {usingDefault && (
          <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-stone-100 text-stone-500">
            using default
          </span>
        )}
      </div>
      <p className="text-xs text-stone-400">
        System prompt for the Release notes feed. Runs alongside the Posts
        narrator on every merged PR — same LLM, same trigger, different voice.
        Leave empty to use the bundled default. Changes apply to new merges and
        any future re-narration via Posts Backfill.
      </p>
      <textarea
        value={draft}
        onChange={(e) => setDraftOverride(e.target.value)}
        rows={12}
        placeholder="Leave empty to use the built-in release-notes prompt. Override here to change tone, sections, or formatting — for example, drop the emoji header or add a required 'Rollback steps' section."
        spellCheck={false}
        className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-stone-200 bg-stone-50 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent resize-y"
      />
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={handleSave}
          disabled={!isDirty || saveSettings.isPending}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 disabled:opacity-50 cursor-pointer"
        >
          {saveSettings.isPending && <Loader2 size={12} className="animate-spin" />}
          Save prompt
        </button>
        <button
          type="button"
          onClick={handleResetToDefault}
          disabled={!draft || saveSettings.isPending}
          className="text-xs text-stone-500 hover:text-stone-700 disabled:opacity-50 cursor-pointer"
        >
          Reset to default
        </button>
        {savedAt && !isDirty && !error && (
          <span className="inline-flex items-center gap-1 text-xs text-green-600">
            <Check size={12} /> Saved
          </span>
        )}
        {error && <span className="text-xs text-red-500">{error}</span>}
      </div>
    </div>
  );
}

type SlackKind = "narrative" | "release_notes";

function SlackSettingsSection() {
  const { data: settings } = useSettings();
  const saveSettings = useSaveSettings();
  const persistedPosts = settings?.slack?.postsWebhookUrl ?? "";
  const persistedNotes = settings?.slack?.releaseNotesWebhookUrl ?? "";

  const [postsDraft, setPostsDraft] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  const postsValue = postsDraft ?? persistedPosts;
  const notesValue = notesDraft ?? persistedNotes;

  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<{ kind: SlackKind; ok: boolean; msg: string } | null>(null);
  const [testingKind, setTestingKind] = useState<SlackKind | null>(null);

  const postsValid = postsValue.trim() === "" || isHooksSlackUrl(postsValue.trim());
  const notesValid = notesValue.trim() === "" || isHooksSlackUrl(notesValue.trim());
  const isDirty =
    (postsDraft !== null && postsDraft.trim() !== persistedPosts.trim()) ||
    (notesDraft !== null && notesDraft.trim() !== persistedNotes.trim());

  async function handleSave() {
    if (!settings) return;
    if (!postsValid || !notesValid) {
      setError("Webhook URL must be https://hooks.slack.com/...");
      return;
    }
    setError(null);
    try {
      const next: OrgSettings = {
        ...settings,
        slack: {
          postsWebhookUrl: postsValue.trim() ? postsValue.trim() : undefined,
          releaseNotesWebhookUrl: notesValue.trim() ? notesValue.trim() : undefined,
        },
      };
      // Strip an entirely-empty slack object so the settings JSON stays clean.
      if (!next.slack?.postsWebhookUrl && !next.slack?.releaseNotesWebhookUrl) {
        delete next.slack;
      }
      await saveSettings.mutateAsync(next);
      setPostsDraft(null);
      setNotesDraft(null);
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleTest(kind: SlackKind) {
    const url = kind === "release_notes" ? notesValue.trim() : postsValue.trim();
    if (!url) {
      setTestStatus({ kind, ok: false, msg: "Paste a webhook URL first." });
      return;
    }
    if (!isHooksSlackUrl(url)) {
      setTestStatus({ kind, ok: false, msg: "Must be https://hooks.slack.com/..." });
      return;
    }
    setTestingKind(kind);
    setTestStatus(null);
    try {
      const res = await apiFetch("/api/slack/test", {
        method: "POST",
        body: JSON.stringify({ url, kind }),
      });
      if (!res.ok) {
        const detail = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(detail?.error ?? `Test failed (HTTP ${res.status})`);
      }
      setTestStatus({ kind, ok: true, msg: "Test message posted to your channel." });
    } catch (err) {
      setTestStatus({ kind, ok: false, msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setTestingKind(null);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-stone-200 p-5 space-y-4">
      <div className="flex items-center gap-2">
        <MessageSquare size={14} className="text-stone-500" />
        <h2 className="text-sm font-semibold text-stone-900">Slack</h2>
      </div>
      <p className="text-xs text-stone-400">
        Mirror Posts and Release notes to Slack using a dedicated Slack app's
        incoming webhooks — one webhook per channel.{" "}
        <a
          href="https://api.slack.com/apps?new_app=1"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline"
        >
          Create a Slack app
        </a>{" "}
        → enable Incoming Webhooks → "Add New Webhook to Workspace" → copy the URL.
        Leave a field empty to disable that feed. Test before saving to make sure
        the channel receives messages.
      </p>

      <SlackWebhookField
        label="Posts feed"
        helpText="First-person chat-style narratives. One message per merged PR."
        value={postsValue}
        onChange={setPostsDraft}
        valid={postsValid}
        onTest={() => handleTest("narrative")}
        testing={testingKind === "narrative"}
        testStatus={testStatus?.kind === "narrative" ? testStatus : null}
      />

      <SlackWebhookField
        label="Release notes feed"
        helpText="Structured release notes. One message per merged PR."
        value={notesValue}
        onChange={setNotesDraft}
        valid={notesValid}
        onTest={() => handleTest("release_notes")}
        testing={testingKind === "release_notes"}
        testStatus={testStatus?.kind === "release_notes" ? testStatus : null}
      />

      <div className="flex items-center gap-3 flex-wrap border-t border-stone-100 pt-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={!isDirty || saveSettings.isPending}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 disabled:opacity-50 cursor-pointer"
        >
          {saveSettings.isPending && <Loader2 size={12} className="animate-spin" />}
          Save
        </button>
        {savedAt && !isDirty && !error && (
          <span className="inline-flex items-center gap-1 text-xs text-green-600">
            <Check size={12} /> Saved
          </span>
        )}
        {error && <span className="text-xs text-red-500">{error}</span>}
      </div>
    </div>
  );
}

function SlackWebhookField(props: {
  label: string;
  helpText: string;
  value: string;
  onChange: (v: string) => void;
  valid: boolean;
  onTest: () => void;
  testing: boolean;
  testStatus: { ok: boolean; msg: string } | null;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <label className="text-xs font-semibold text-stone-700">{props.label}</label>
        <span className="text-xs text-stone-400">{props.helpText}</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="text"
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          placeholder="https://hooks.slack.com/services/T.../B.../..."
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className={
            "flex-1 min-w-[260px] px-2.5 py-1.5 text-xs font-mono rounded-lg border bg-stone-50 focus:outline-none focus:ring-2 focus:ring-accent/30 " +
            (props.valid ? "border-stone-200 focus:border-accent" : "border-red-300 focus:border-red-400")
          }
        />
        <button
          type="button"
          onClick={props.onTest}
          disabled={props.testing}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-stone-200 bg-white text-xs text-stone-700 hover:border-stone-300 hover:text-stone-900 disabled:opacity-50 cursor-pointer"
        >
          {props.testing && <Loader2 size={12} className="animate-spin" />}
          Test
        </button>
      </div>
      {props.testStatus && (
        <p className={"text-xs " + (props.testStatus.ok ? "text-green-600" : "text-red-500")}>
          {props.testStatus.msg}
        </p>
      )}
    </div>
  );
}

function isHooksSlackUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && u.hostname === "hooks.slack.com";
  } catch {
    return false;
  }
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
