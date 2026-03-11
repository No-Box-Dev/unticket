import { useState, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useRepos } from "@/hooks/useGitHub";
import { useSettings, useSaveSettings, usePeople, useSavePeople, useAgentRules, useSaveAgentRules } from "@/hooks/useConfigRepo";
import { TeamManagement } from "@/components/settings/TeamManagement";
import { PeopleManagement } from "@/components/settings/PeopleManagement";
import { pushClaudeMdToRepos, buildClaudeMdPreview } from "@/lib/claude-md-sync";
import { triggerSyncWithProgress, type SyncProgress } from "@/lib/github";
import { Loader2, Plus, X, Pencil, Check, ExternalLink, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export function SettingsTab() {
  const { user, selectedOrg, logout } = useAuth();
  const { data: repos } = useRepos();
  const { data: settings } = useSettings();
  const saveSettings = useSaveSettings();
  const { data: people } = usePeople();
  const savePeople = useSavePeople();

  return (
    <div className="max-w-2xl space-y-6">
      {/* Account */}
      <div className="bg-white dark:bg-dark-raised rounded-xl border border-stone-200 dark:border-white/[0.06] p-5 space-y-3">
        <h2 className="text-sm font-semibold text-stone-900 dark:text-neutral-100">Account</h2>
        <div className="flex items-center gap-3">
          {user && (
            <img
              src={user.avatar_url}
              alt={user.login}
              className="w-10 h-10 rounded-full"
            />
          )}
          <div>
            <div className="text-sm font-medium text-stone-800 dark:text-neutral-200">
              {user?.name ?? user?.login}
            </div>
            <div className="text-xs text-stone-400 dark:text-neutral-500">@{user?.login}</div>
          </div>
        </div>
        <div className="text-xs text-stone-400 dark:text-neutral-500">
          Organisation: <span className="font-medium text-stone-600 dark:text-neutral-400">{selectedOrg}</span>
        </div>
        <button
          onClick={logout}
          className="text-xs text-red-500 hover:text-red-700 cursor-pointer"
        >
          Disconnect GitHub
        </button>
      </div>

      {/* Teams */}
      {settings && repos && (
        <TeamManagement
          settings={settings}
          saveSettings={saveSettings}
          repos={repos as any}
        />
      )}

      {/* People */}
      {people && settings && (
        <PeopleManagement
          people={people}
          savePeople={savePeople}
          teams={settings.teams}
        />
      )}

      {/* Tracked repos */}
      <div className="bg-white dark:bg-dark-raised rounded-xl border border-stone-200 dark:border-white/[0.06] p-5 space-y-3">
        <h2 className="text-sm font-semibold text-stone-900 dark:text-neutral-100">
          Tracked Repositories ({repos?.length ?? 0})
        </h2>
        <p className="text-xs text-stone-400 dark:text-neutral-500">
          All repositories in {selectedOrg} are tracked by default. Mark repos as
          draft to hide their issues from the Sprint view.
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
                    ? "bg-stone-100 dark:bg-dark-overlay text-stone-400 dark:text-neutral-500"
                    : "bg-stone-50 dark:bg-white/[0.04] text-stone-600 dark:text-neutral-400 hover:bg-stone-100 dark:hover:bg-white/[0.06]"
                }`}
              >
                {repo.name}
                {isDraft && (
                  <span className="ml-1 text-stone-300 dark:text-neutral-600">(draft)</span>
                )}
                {!isDraft && repo.language && (
                  <span className="text-stone-300 dark:text-neutral-600 ml-1">({repo.language})</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Agent Integration */}
      <AgentIntegrationSection org={selectedOrg!} repos={repos as any} />

      {/* Webhooks */}
      <div className="bg-white dark:bg-dark-raised rounded-xl border border-stone-200 dark:border-white/[0.06] p-5 space-y-3">
        <h2 className="text-sm font-semibold text-stone-900 dark:text-neutral-100">Webhooks</h2>
        <p className="text-xs text-stone-400 dark:text-neutral-500">
          Set up a GitHub webhook for real-time updates. Go to your org's webhook
          settings and add a new webhook with these values:
        </p>
        <div className="space-y-2">
          <div>
            <label className="text-xs font-medium text-stone-500 dark:text-neutral-400">Payload URL</label>
            <div className="mt-0.5 flex items-center gap-2">
              <code className="text-xs bg-stone-100 dark:bg-dark-overlay px-2 py-1 rounded text-stone-700 dark:text-neutral-300 flex-1 select-all">
                {`${window.location.origin}/api/webhook`}
              </code>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-stone-500 dark:text-neutral-400">Content type</label>
            <div className="mt-0.5">
              <code className="text-xs bg-stone-100 dark:bg-dark-overlay px-2 py-1 rounded text-stone-700 dark:text-neutral-300 select-all">
                application/json
              </code>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-stone-500 dark:text-neutral-400">Events</label>
            <p className="text-xs text-stone-400 dark:text-neutral-500 mt-0.5">
              Select "Let me select individual events" → check Issues, Pull requests, and Members.
            </p>
          </div>
        </div>
        <a
          href={`https://github.com/organizations/${selectedOrg}/settings/hooks/new`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-xs text-blue-600 hover:text-blue-800 hover:underline"
        >
          Open {selectedOrg} webhook settings →
        </a>
      </div>

      {/* Full Re-sync */}
      <FullResyncSection />

      {/* About */}
      <div className="bg-white dark:bg-dark-raised rounded-xl border border-stone-200 dark:border-white/[0.06] p-5 space-y-2">
        <h2 className="text-sm font-semibold text-stone-900 dark:text-neutral-100">About unticket.ai</h2>
        <p className="text-xs text-stone-400 dark:text-neutral-500">
          AI-powered project management dashboard for GitHub organisations.
          Your token is stored locally — no data is sent to any server.
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
    <div className="bg-white dark:bg-dark-raised rounded-xl border border-stone-200 dark:border-white/[0.06] p-5 space-y-3">
      <h2 className="text-sm font-semibold text-stone-900 dark:text-neutral-100">Data Sync</h2>
      <p className="text-xs text-stone-400 dark:text-neutral-500">
        Run a full re-sync to fetch all historical PRs and issues from GitHub.
        This ignores the incremental sync timestamp and re-fetches everything.
        Use this to backfill data that was missed during initial setup.
      </p>
      <button
        onClick={handleResync}
        disabled={syncing}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand/90 disabled:opacity-50 cursor-pointer"
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

function AgentIntegrationSection({ org, repos }: { org: string; repos: { name: string }[] | undefined }) {
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
  const repoNames = useMemo(() => (repos ?? []).map((r) => r.name), [repos]);
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
    <div className="bg-white dark:bg-dark-raised rounded-xl border border-stone-200 dark:border-white/[0.06] p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-stone-900 dark:text-neutral-100">Agent Rules</h2>
        <p className="text-xs text-stone-400 dark:text-neutral-500 mt-1">
          Rules pushed to each repo's <code className="bg-stone-100 dark:bg-dark-overlay px-1 rounded">CLAUDE.md</code> so
          coding agents follow org conventions. Updates are appended in a managed section.
        </p>
      </div>

      {/* Rules list */}
      <div className="space-y-1.5">
        {currentRules.map((rule, i) => (
          <div key={i} className="group flex items-start gap-2 bg-stone-50 dark:bg-white/[0.04] rounded-lg px-3 py-2">
            {editingIdx === i ? (
              <>
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  className="flex-1 text-xs bg-white dark:bg-dark-raised border border-stone-300 dark:border-white/[0.1] rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand/30 resize-y min-h-[60px]"
                  rows={3}
                />
                <button onClick={confirmEdit} className="text-brand hover:text-brand/80 cursor-pointer shrink-0 mt-1">
                  <Check size={14} />
                </button>
                <button onClick={() => setEditingIdx(null)} className="text-stone-400 dark:text-neutral-500 hover:text-stone-600 dark:hover:text-neutral-400 cursor-pointer shrink-0 mt-1">
                  <X size={14} />
                </button>
              </>
            ) : (
              <>
                <p className="flex-1 text-xs text-stone-700 dark:text-neutral-300 whitespace-pre-wrap">{rule}</p>
                <button
                  onClick={() => startEdit(i)}
                  className="text-stone-300 dark:text-neutral-600 hover:text-stone-500 dark:hover:text-neutral-400 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                >
                  <Pencil size={12} />
                </button>
                <button
                  onClick={() => deleteRule(i)}
                  className="text-stone-300 dark:text-neutral-600 hover:text-red-500 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
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
          placeholder="Add a rule (e.g. When creating PRs, reference features with Part of .gitpulse#N)"
          className="flex-1 px-3 py-2 rounded-lg border border-stone-200 dark:border-white/[0.06] bg-white dark:bg-dark-raised text-xs focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand resize-y min-h-[40px]"
          rows={2}
        />
        <button
          onClick={addRule}
          disabled={!newRule.trim()}
          className="px-3 py-2 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand/90 disabled:opacity-50 cursor-pointer flex items-center gap-1 shrink-0"
        >
          <Plus size={14} />
          Add
        </button>
      </div>

      {/* Preview */}
      <div className="space-y-2 border-t border-stone-100 dark:border-white/[0.06] pt-4">
        <button
          onClick={() => setShowPreview(!showPreview)}
          className="text-xs text-brand hover:text-brand/80 cursor-pointer"
        >
          {showPreview ? "Hide preview" : "Preview CLAUDE.md content"}
        </button>
        {showPreview && (
          <pre className="rounded-lg border border-stone-200 dark:border-white/[0.06] bg-stone-50 dark:bg-white/[0.04] px-4 py-3 text-xs text-stone-600 dark:text-neutral-400 font-mono whitespace-pre-wrap overflow-y-auto max-h-[400px]">
            {preview}
          </pre>
        )}
      </div>

      {/* Repo selector */}
      <div className="space-y-2 border-t border-stone-100 dark:border-white/[0.06] pt-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-stone-700 dark:text-neutral-300">
              Push to repositories ({selected.size}/{repoNames.length})
            </span>
            <button
              onClick={toggleAll}
              className="text-xs text-brand hover:text-brand/80 cursor-pointer"
            >
              {selected.size === repoNames.length ? "Deselect all" : "Select all"}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1 max-h-40 overflow-y-auto">
            {repoNames.map((name) => (
              <div key={name} className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-stone-50 dark:hover:bg-white/[0.06] text-xs text-stone-600 dark:text-neutral-400">
                <label className="flex items-center gap-1.5 flex-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.has(name)}
                    onChange={() => toggleRepo(name)}
                    className="rounded border-stone-300 dark:border-white/[0.1] text-brand focus:ring-brand/30"
                  />
                  {name}
                </label>
                <a
                  href={`https://github.com/${org}/${name}/blob/main/CLAUDE.md`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-stone-300 dark:text-neutral-600 hover:text-brand shrink-0"
                  title="View CLAUDE.md"
                >
                  <ExternalLink size={11} />
                </a>
              </div>
            ))}
          </div>

          <button
            onClick={handlePush}
            disabled={syncing || selected.size === 0}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand/90 disabled:opacity-50 cursor-pointer"
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
                  <p className="text-stone-400 dark:text-neutral-500">{result.skipped} already up to date</p>
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
                      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-stone-50 dark:bg-white/[0.04] text-stone-600 dark:text-neutral-400 hover:text-brand hover:bg-stone-100 dark:hover:bg-white/[0.06] transition-colors"
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
