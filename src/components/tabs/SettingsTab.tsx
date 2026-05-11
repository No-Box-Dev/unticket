/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useRepos, useOrgMembers } from "@/hooks/useGitHub";
import { useSettings, useSaveSettings, usePeople, useSavePeople, useAgentRules, useSaveAgentRules } from "@/hooks/useConfigRepo";
import { useFeedProjects } from "@/hooks/useNoxlink";
import { backfillProjectPrs } from "@/lib/noxlink-api";
import { PeopleManagement } from "@/components/settings/PeopleManagement";
import { pushClaudeMdToRepos, buildClaudeMdPreview, fetchClaudeMdContent, checkOutdatedRepos } from "@/lib/claude-md-sync";
import { triggerSyncWithProgress, type SyncProgress } from "@/lib/github";
import { Loader2, Plus, X, Pencil, Check, ExternalLink, RefreshCw, Eye, Sparkles } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export function SettingsTab() {
  const { user, selectedOrg, logout } = useAuth();
  const { data: repos } = useRepos({ includeAll: true });
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

      {/* Agent Integration */}
      <AgentIntegrationSection org={selectedOrg!} repos={repos as any} />

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
  const [result, setResult] = useState<{ queued: number; found: number; errors: string[] } | null>(null);

  async function handleBackfillAll() {
    if (activeProjects.length === 0) return;
    setRunning(true);
    setResult(null);
    setProgress({ done: 0, total: activeProjects.length, current: null });

    let queuedTotal = 0;
    let foundTotal = 0;
    const errors: string[] = [];

    for (let i = 0; i < activeProjects.length; i++) {
      const p = activeProjects[i];
      setProgress({ done: i, total: activeProjects.length, current: p.repo });
      try {
        const res = await backfillProjectPrs(p.id, days);
        queuedTotal += res.queued ?? 0;
        foundTotal += res.found ?? 0;
      } catch (err) {
        errors.push(`${p.repo}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    setProgress({ done: activeProjects.length, total: activeProjects.length, current: null });
    setResult({ queued: queuedTotal, found: foundTotal, errors });
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
            Queued {result.queued} new post{result.queued === 1 ? "" : "s"} from {result.found} PR{result.found === 1 ? "" : "s"} found.
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

function AgentIntegrationSection({ org, repos }: { org: string; repos: { name: string; inactive?: boolean }[] | undefined }) {
  const { data: savedRules } = useAgentRules();
  const saveRulesMut = useSaveAgentRules();

  const [rules, setRules] = useState<string[] | null>(null);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [newRule, setNewRule] = useState("");

  const [selectedRepos, setSelectedRepos] = useState<Set<string> | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ updated: number; skipped: number; errors: string[]; updatedRepos: string[] } | null>(null);

  // Initialize from saved rules once loaded
  const currentRules = rules ?? savedRules ?? [];
  // Only ever push CLAUDE.md to ACTIVE repos — drafts and archived repos are
  // hidden across the app and shouldn't get rule updates either.
  const repoNames = useMemo(
    () => (repos ?? []).filter((r) => !r.inactive).map((r) => r.name),
    [repos],
  );
  const selected = selectedRepos ?? new Set(repoNames);

  function saveRules(next: string[]) {
    setRules(next);
    saveRulesMut.mutate(next);
  }

  function addRule() {
    const text = newRule.trim();
    if (!text) return;
    saveRules([...currentRules, text]);
    setNewRule("");
  }

  function deleteRule(idx: number) {
    saveRules(currentRules.filter((_, i) => i !== idx));
  }

  function startEdit(idx: number) {
    setEditingIdx(idx);
    setEditText(currentRules[idx]);
  }

  function confirmEdit() {
    if (editingIdx === null) return;
    const next = currentRules.map((r, i) => (i === editingIdx ? editText.trim() : r));
    saveRules(next);
    setEditingIdx(null);
  }

  function toggleRepo(name: string) {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setSelectedRepos(next);
  }

  function toggleAll() {
    if (selected.size === repoNames.length) setSelectedRepos(new Set());
    else setSelectedRepos(new Set(repoNames));
  }

  const [showPreview, setShowPreview] = useState(false);
  const preview = buildClaudeMdPreview(org, currentRules);

  // View CLAUDE.md state
  const [viewingRepo, setViewingRepo] = useState<string | null>(null);
  const [viewContent, setViewContent] = useState<string | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewError, setViewError] = useState<string | null>(null);

  async function handleViewRepo(repo: string) {
    if (viewingRepo === repo) {
      setViewingRepo(null);
      return;
    }
    setViewingRepo(repo);
    setViewContent(null);
    setViewError(null);
    setViewLoading(true);
    try {
      const file = await fetchClaudeMdContent(org, repo);
      if (!file) {
        setViewError("No CLAUDE.md found in this repository.");
      } else {
        setViewContent(file.content);
      }
    } catch (err: any) {
      setViewError(err.status === 403 ? "No access to this repository." : (err.message ?? "Unknown error"));
    } finally {
      setViewLoading(false);
    }
  }

  // Check outdated state
  const [checking, setChecking] = useState(false);
  const [checkProgress, setCheckProgress] = useState<{ done: number; total: number } | null>(null);
  const [outdatedRepos, setOutdatedRepos] = useState<string[] | null>(null);
  const [noFileRepos, setNoFileRepos] = useState<string[]>([]);
  const [checkErrors, setCheckErrors] = useState<string[]>([]);

  async function handleCheckOutdated() {
    const targets = repoNames.filter((r) => selected.has(r));
    if (targets.length === 0) return;
    setChecking(true);
    setOutdatedRepos(null);
    setNoFileRepos([]);
    setCheckErrors([]);
    setCheckProgress({ done: 0, total: targets.length });
    try {
      const res = await checkOutdatedRepos(org, targets, currentRules, (done, total) =>
        setCheckProgress({ done, total }),
      );
      setOutdatedRepos(res.outdated);
      setNoFileRepos(res.noFile);
      setCheckErrors(res.errors);
    } catch {
      setCheckErrors(["Unexpected error checking repos"]);
    } finally {
      setChecking(false);
      setCheckProgress(null);
    }
  }

  async function handleUpdateOutdated() {
    if (!outdatedRepos || outdatedRepos.length === 0) return;
    const targets = [...outdatedRepos, ...noFileRepos];
    if (targets.length === 0) return;
    setSyncing(true);
    setResult(null);
    setProgress({ done: 0, total: targets.length });
    try {
      const res = await pushClaudeMdToRepos(org, targets, currentRules, (done, total) =>
        setProgress({ done, total }),
      );
      setResult(res);
      // Reset check state after successful update
      setOutdatedRepos(null);
      setNoFileRepos([]);
    } catch {
      setResult({ updated: 0, skipped: 0, errors: ["Unexpected error"], updatedRepos: [] });
    } finally {
      setSyncing(false);
      setProgress(null);
    }
  }

  async function handlePush() {
    const targets = repoNames.filter((r) => selected.has(r));
    if (targets.length === 0) return;
    setSyncing(true);
    setResult(null);
    setProgress({ done: 0, total: targets.length });
    try {
      const res = await pushClaudeMdToRepos(org, targets, currentRules, (done, total) =>
        setProgress({ done, total }),
      );
      setResult(res);
    } catch {
      setResult({ updated: 0, skipped: 0, errors: ["Unexpected error"], updatedRepos: [] });
    } finally {
      setSyncing(false);
      setProgress(null);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-stone-200 p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-stone-900">Agent Rules</h2>
        <p className="text-xs text-stone-400 mt-1">
          Rules pushed to each repo's <code className="bg-stone-100 px-1 rounded">CLAUDE.md</code> so
          coding agents follow org conventions. Updates are appended in a managed section.
        </p>
      </div>

      {/* Rules list */}
      <div className="space-y-1.5">
        {currentRules.map((rule, i) => (
          <div key={i} className="group flex items-start gap-2 bg-stone-50 rounded-lg px-3 py-2">
            {editingIdx === i ? (
              <>
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  className="flex-1 text-xs bg-white border border-stone-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-accent/30 resize-y min-h-[60px]"
                  rows={3}
                />
                <button onClick={confirmEdit} className="text-accent hover:text-accent/80 cursor-pointer shrink-0 mt-1">
                  <Check size={14} />
                </button>
                <button onClick={() => setEditingIdx(null)} className="text-stone-400 hover:text-stone-600 cursor-pointer shrink-0 mt-1">
                  <X size={14} />
                </button>
              </>
            ) : (
              <>
                <p className="flex-1 text-xs text-stone-700 whitespace-pre-wrap">{rule}</p>
                <button
                  onClick={() => startEdit(i)}
                  className="text-stone-300 hover:text-stone-500 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                >
                  <Pencil size={12} />
                </button>
                <button
                  onClick={() => deleteRule(i)}
                  className="text-stone-300 hover:text-red-500 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                >
                  <X size={14} />
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Add rule */}
      <div className="flex items-start gap-2">
        <textarea
          value={newRule}
          onChange={(e) => setNewRule(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), addRule())}
          placeholder="Add a rule (e.g. When creating PRs, reference features with Part of unticket#N)"
          className="flex-1 px-3 py-2 rounded-lg border border-stone-200 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent resize-y min-h-[40px]"
          rows={2}
        />
        <button
          onClick={addRule}
          disabled={!newRule.trim()}
          className="px-3 py-2 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 disabled:opacity-50 cursor-pointer flex items-center gap-1 shrink-0"
        >
          <Plus size={14} />
          Add
        </button>
      </div>

      {/* Preview */}
      <div className="space-y-2 border-t border-stone-100 pt-4">
        <button
          onClick={() => setShowPreview(!showPreview)}
          className="text-xs text-accent hover:text-accent/80 cursor-pointer"
        >
          {showPreview ? "Hide preview" : "Preview CLAUDE.md content"}
        </button>
        {showPreview && (
          <pre className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-xs text-stone-600 font-mono whitespace-pre-wrap overflow-y-auto max-h-[400px]">
            {preview}
          </pre>
        )}
      </div>

      {/* Repo selector */}
      <div className="space-y-2 border-t border-stone-100 pt-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-stone-700">
              Push to repositories ({selected.size}/{repoNames.length})
            </span>
            <button
              onClick={toggleAll}
              className="text-xs text-accent hover:text-accent/80 cursor-pointer"
            >
              {selected.size === repoNames.length ? "Deselect all" : "Select all"}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1 max-h-40 overflow-y-auto">
            {repoNames.map((name) => (
              <div key={name} className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-stone-50 text-xs text-stone-600">
                <label className="flex items-center gap-1.5 flex-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.has(name)}
                    onChange={() => toggleRepo(name)}
                    className="rounded border-stone-300 text-accent focus:ring-accent/30"
                  />
                  {name}
                </label>
                <button
                  onClick={() => handleViewRepo(name)}
                  className={`shrink-0 cursor-pointer ${viewingRepo === name ? "text-accent" : "text-stone-300  hover:text-accent"}`}
                  title="View CLAUDE.md"
                >
                  <Eye size={11} />
                </button>
                <a
                  href={`https://github.com/${org}/${name}/blob/main/CLAUDE.md`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-stone-300 hover:text-accent shrink-0"
                  title="View on GitHub"
                >
                  <ExternalLink size={11} />
                </a>
              </div>
            ))}
          </div>

          {/* CLAUDE.md inline viewer */}
          {viewingRepo && (
            <div className="rounded-lg border border-stone-200 bg-stone-50 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-stone-200">
                <span className="text-xs font-medium text-stone-700">{viewingRepo}/CLAUDE.md</span>
                <button onClick={() => setViewingRepo(null)} className="text-stone-400 hover:text-stone-600 cursor-pointer">
                  <X size={14} />
                </button>
              </div>
              <div className="px-4 py-3 max-h-[400px] overflow-y-auto">
                {viewLoading && (
                  <div className="flex items-center gap-2 text-xs text-stone-400">
                    <Loader2 size={14} className="animate-spin" /> Loading...
                  </div>
                )}
                {viewError && <p className="text-xs text-stone-400">{viewError}</p>}
                {viewContent && (
                  <pre className="text-xs text-stone-600 font-mono whitespace-pre-wrap">{viewContent}</pre>
                )}
              </div>
            </div>
          )}

          {/* Check for updates */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleCheckOutdated}
              disabled={checking || selected.size === 0}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-stone-200 text-xs font-medium text-stone-600 hover:bg-stone-50 disabled:opacity-50 cursor-pointer"
            >
              {checking && <Loader2 size={14} className="animate-spin" />}
              {checking
                ? `Checking... (${checkProgress?.done ?? 0}/${checkProgress?.total ?? 0})`
                : "Check for updates"}
            </button>
            {outdatedRepos !== null && !checking && (
              <span className={`text-xs font-medium ${outdatedRepos.length + noFileRepos.length > 0 ? "text-amber-600  " : "text-green-600  "}`}>
                {outdatedRepos.length + noFileRepos.length > 0
                  ? `${outdatedRepos.length + noFileRepos.length} repo${outdatedRepos.length + noFileRepos.length !== 1 ? "s" : ""} need updating`
                  : "All up to date"}
              </span>
            )}
          </div>
          {outdatedRepos !== null && (outdatedRepos.length + noFileRepos.length > 0) && !checking && (
            <div className="space-y-2">
              <div className="text-xs text-stone-500 space-y-0.5">
                {outdatedRepos.map((r) => (
                  <p key={r}>• {r} <span className="text-stone-400">(outdated)</span></p>
                ))}
                {noFileRepos.map((r) => (
                  <p key={r}>• {r} <span className="text-stone-400">(no file)</span></p>
                ))}
              </div>
              <button
                onClick={handleUpdateOutdated}
                disabled={syncing}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-medium hover:bg-amber-600 disabled:opacity-50 cursor-pointer"
              >
                {syncing && <Loader2 size={14} className="animate-spin" />}
                {syncing
                  ? `Updating... (${progress?.done ?? 0}/${progress?.total ?? 0})`
                  : `Update ${outdatedRepos.length + noFileRepos.length} repo${outdatedRepos.length + noFileRepos.length !== 1 ? "s" : ""}`}
              </button>
            </div>
          )}
          {checkErrors.length > 0 && (
            <div className="text-xs text-red-500 space-y-0.5">
              {checkErrors.map((e, i) => <p key={i}>{e}</p>)}
            </div>
          )}

          <button
            onClick={handlePush}
            disabled={syncing || selected.size === 0}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 disabled:opacity-50 cursor-pointer"
          >
            {syncing && <Loader2 size={14} className="animate-spin" />}
            {syncing
              ? `Updating... (${progress?.done ?? 0}/${progress?.total ?? 0})`
              : `Push to ${selected.size} repo${selected.size !== 1 ? "s" : ""}`}
          </button>

          {result && (
            <div className="text-xs space-y-2">
              <div className="space-y-1">
                {result.updated > 0 && (
                  <p className="text-green-600">{result.updated} repo{result.updated !== 1 ? "s" : ""} updated</p>
                )}
                {result.skipped > 0 && (
                  <p className="text-stone-400">{result.skipped} already up to date</p>
                )}
                {result.errors.map((e, i) => (
                  <p key={i} className="text-red-500">{e}</p>
                ))}
              </div>
              {result.updatedRepos.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {result.updatedRepos.map((name) => (
                    <a
                      key={name}
                      href={`https://github.com/${org}/${name}/edit/main/CLAUDE.md`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-stone-50 text-stone-600 hover:text-accent hover:bg-stone-100 transition-colors"
                    >
                      {name}
                      <ExternalLink size={10} />
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
    </div>
  );
}
