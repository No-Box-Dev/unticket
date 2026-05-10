import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, ExternalLink, FileText, Pencil, Save, Plus, Loader2, GitPullRequest, GitMerge, Search, Link2 } from "lucide-react";
import Markdown from "react-markdown";
import { AssignDropdown } from "./AssignDropdown";
import { usePRsForFeature, useLinkPR, useUnlinkPR } from "@/hooks/useGitHub";
import { fetchAllPRs } from "@/lib/github";
import { STATUS_COLORS as SHARED_STATUS_COLORS, STATUS_LABELS as SHARED_STATUS_LABELS } from "@/lib/types";
import { withStatusTransition } from "@/lib/github-features";
import type { Feature, FeatureStatus } from "@/lib/types";

const STATUS_OPTIONS: FeatureStatus[] = ["todo", "staging", "ready", "production", "future"];

// ---------- Component ----------

interface FeatureDetailModalProps {
  feature: Feature;
  allPeople: string[];
  onClose: () => void;
  onUpdate: (updated: Feature) => void;
}

export function FeatureDetailModal({ feature, allPeople, onClose, onUpdate }: FeatureDetailModalProps) {
  const [draft, setDraft] = useState<Feature>({ ...feature });
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [showLinkPR, setShowLinkPR] = useState(false);
  const [prSearch, setPrSearch] = useState("");
  const [prRepoFilter, setPrRepoFilter] = useState("");
  const [prCreatorFilter, setPrCreatorFilter] = useState("");

  // Linked PRs (branch + explicit)
  const { data: linkedPRs, isLoading: prsLoading } = usePRsForFeature(feature.id);
  const linkPRMut = useLinkPR();
  const unlinkPRMut = useUnlinkPR();

  // All PRs for the link dropdown — only fetch when dropdown is open
  const { data: allPRsData } = useQuery({
    queryKey: ["allPRsForLink"],
    queryFn: () => fetchAllPRs(),
    enabled: showLinkPR,
    staleTime: 5 * 60 * 1000,
  });

  // Derived data for link dropdown
  const availableRepos = useMemo(() =>
    [...new Set((allPRsData ?? []).map((pr) => pr.repo).filter(Boolean))].sort(),
    [allPRsData],
  );
  const availableCreators = useMemo(() =>
    [...new Set((allPRsData ?? []).map((pr) => pr.user?.login).filter(Boolean))].sort() as string[],
    [allPRsData],
  );
  const filteredLinkablePRs = useMemo(() => {
    const linkedSet = new Set((linkedPRs ?? []).map((pr) => `${pr.repo}:${pr.number}`));
    const q = prSearch.toLowerCase();
    return (allPRsData ?? [])
      .filter((pr) => !linkedSet.has(`${pr.repo}:${pr.number}`))
      .filter((pr) => !prRepoFilter || pr.repo === prRepoFilter)
      .filter((pr) => !prCreatorFilter || pr.user?.login === prCreatorFilter)
      .filter((pr) => !q || pr.title.toLowerCase().includes(q))
      .slice(0, 20);
  }, [allPRsData, linkedPRs, prSearch, prRepoFilter, prCreatorFilter]);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hasUnsavedChanges = useRef(false);

  const save = useCallback((next: Feature) => {
    hasUnsavedChanges.current = false;
    onUpdate({ ...next });
  }, [onUpdate]);

  const saveDebounced = useCallback((next: Feature) => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => save(next), 500);
  }, [save]);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  function update(patch: Partial<Feature>, debounce = false) {
    setDraft((d) => {
      const next = { ...d, ...patch };
      hasUnsavedChanges.current = true;
      if (debounce) {
        saveDebounced(next);
      } else {
        clearTimeout(debounceRef.current);
        save(next);
      }
      return next;
    });
  }

  function handleClose() {
    // Flush any pending debounced save, but only if there are unsaved changes
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = undefined;
      if (hasUnsavedChanges.current) {
        onUpdate({ ...draft });
        hasUnsavedChanges.current = false;
      }
    }
    onClose();
  }

  const plan = draft.plan ?? "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={handleClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="bg-white rounded-xl shadow-xl w-full max-w-3xl mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
          <div className="group/title flex items-center gap-2 flex-1 min-w-0">
            <input
              value={draft.title}
              onChange={(e) => update({ title: e.target.value }, true)}
              className="text-lg font-semibold text-stone-800 bg-transparent w-full rounded px-2 py-1 -mx-2 border border-transparent hover:border-stone-200 focus:border-accent/40 focus:ring-2 focus:ring-accent/20 outline-none transition-all"
              title="Click to edit title"
            />
            <Pencil size={14} className="shrink-0 text-stone-300 group-hover/title:text-stone-400 transition-colors" />
            {draft.url && (
              <a
                href={draft.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="View issue on GitHub"
                className="shrink-0 text-stone-400 hover:text-accent flex items-center gap-1 text-xs"
                title="View issue on GitHub"
              >
                <ExternalLink size={14} aria-hidden="true" />
              </a>
            )}
          </div>
          <button onClick={handleClose} className="text-stone-400 hover:text-stone-600 cursor-pointer ml-2">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-5">
          {/* Meta row */}
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <span className="text-xs text-stone-500 block mb-1">Status</span>
              <select
                value={draft.status}
                onChange={(e) => {
                  const next = withStatusTransition(draft, e.target.value as FeatureStatus);
                  setDraft(next);
                  hasUnsavedChanges.current = true;
                  save(next);
                }}
                className="px-2.5 py-1.5 rounded-md border border-stone-200 bg-white text-xs text-stone-700 focus:outline-none focus:border-accent cursor-pointer"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{SHARED_STATUS_LABELS[s]}</option>
                ))}
              </select>
            </div>
            <div>
              <span className="text-xs text-stone-500 block mb-1">Owners</span>
              <AssignDropdown
                owners={draft.owners}
                allPeople={allPeople}
                onChange={(owners) => update({ owners })}
              />
            </div>
          </div>

          {/* Implementation Plan */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-stone-500">Plan</span>
              <div className="flex items-center gap-2">
                {draft.url && (
                  <a
                    href={draft.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-stone-400 hover:text-accent flex items-center gap-1"
                    title="View on GitHub"
                  >
                    <ExternalLink size={12} />
                  </a>
                )}
                {!editMode && (
                  <button
                    onClick={() => { setEditContent(plan); setEditMode(true); }}
                    className="text-xs text-stone-400 hover:text-accent flex items-center gap-1 cursor-pointer"
                  >
                    <Pencil size={12} />
                    Edit
                  </button>
                )}
              </div>
            </div>

            {!editMode && !plan && (
              <div className="rounded-lg border border-dashed border-stone-200 bg-stone-50 px-4 py-8 text-center text-sm text-stone-400">
                <FileText size={20} className="mx-auto mb-2 text-stone-300" />
                No plan yet.
                <br />
                <button
                  onClick={() => { setEditContent(""); setEditMode(true); }}
                  className="mt-2 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 cursor-pointer"
                >
                  Create Plan
                </button>
              </div>
            )}

            {!editMode && plan && (
              <div className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700 overflow-y-auto max-h-[40vh] prose prose-sm prose-stone max-w-none">
                <Markdown>{plan}</Markdown>
              </div>
            )}

            {editMode && (
              <div className="space-y-2">
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm text-stone-700 font-mono whitespace-pre-wrap focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent resize-y min-h-[200px] max-h-[50vh]"
                  rows={12}
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      update({ plan: editContent });
                      setEditMode(false);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent/90 cursor-pointer"
                  >
                    <Save size={12} />
                    Save
                  </button>
                  <button
                    onClick={() => setEditMode(false)}
                    className="px-3 py-1.5 rounded-lg border border-stone-200 text-xs text-stone-600 hover:bg-stone-50 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Linked PRs */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="text-xs text-stone-500">
                Linked PRs
                {linkedPRs && linkedPRs.length > 0 && (
                  <span className="text-stone-400 ml-1">({linkedPRs.length})</span>
                )}
              </span>
              {prsLoading && <Loader2 size={12} className="animate-spin text-stone-400" />}
              <button
                type="button"
                onClick={() => setShowLinkPR(!showLinkPR)}
                className="text-stone-400 hover:text-accent cursor-pointer ml-auto"
                title="Link a PR"
              >
                <Plus size={14} />
              </button>
            </div>

            {/* Link PR dropdown */}
            {showLinkPR && (
              <div className="mb-2 rounded-lg border border-stone-200 bg-white overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-stone-100">
                  <Search size={14} className="text-stone-400 shrink-0" />
                  <input
                    type="text"
                    value={prSearch}
                    onChange={(e) => setPrSearch(e.target.value)}
                    placeholder="Search PRs by title..."
                    className="flex-1 text-sm bg-transparent border-none outline-none"
                    autoFocus
                  />
                </div>
                {/* Repo + Creator filters */}
                <div className="flex items-center gap-2 px-3 py-1.5 border-b border-stone-100">
                  <select
                    value={prRepoFilter}
                    onChange={(e) => setPrRepoFilter(e.target.value)}
                    className="text-xs px-2 py-1 rounded border border-stone-200 bg-white text-stone-600 focus:outline-none focus:ring-2 focus:ring-accent/30 cursor-pointer"
                  >
                    <option value="">All repos</option>
                    {availableRepos.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <select
                    value={prCreatorFilter}
                    onChange={(e) => setPrCreatorFilter(e.target.value)}
                    className="text-xs px-2 py-1 rounded border border-stone-200 bg-white text-stone-600 focus:outline-none focus:ring-2 focus:ring-accent/30 cursor-pointer"
                  >
                    <option value="">All creators</option>
                    {availableCreators.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="max-h-[200px] overflow-y-auto">
                  {filteredLinkablePRs.length === 0 ? (
                    <div className="px-3 py-4 text-center text-xs text-stone-400">
                      {prSearch || prRepoFilter || prCreatorFilter ? "No matching PRs" : "No PRs available"}
                    </div>
                  ) : filteredLinkablePRs.map((pr) => (
                    <button
                      key={`${pr.repo}:${pr.number}`}
                      type="button"
                      onClick={() => {
                        linkPRMut.mutate({ featureId: feature.id, prRepo: pr.repo ?? "", prNumber: pr.number });
                        setShowLinkPR(false);
                        setPrSearch("");
                        setPrRepoFilter("");
                        setPrCreatorFilter("");
                      }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-stone-50 text-left cursor-pointer"
                    >
                      <Link2 size={12} className="text-stone-400 shrink-0" />
                      <span className="text-xs text-stone-400 shrink-0">{pr.repo}#{pr.number}</span>
                      <span className="text-sm text-stone-700 truncate flex-1">{pr.title}</span>
                      {pr.user && <span className="text-xs text-stone-400 shrink-0">{pr.user.login}</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-1">
              {(linkedPRs ?? []).map((pr) => {
                const isMerged = pr.state === "closed" && pr.html_url.includes("pull");
                const repoName = pr.head.repo?.name ?? "";
                const source = "linkSource" in pr ? (pr.linkSource as string | undefined) : undefined;
                const isManual = source === "manual";
                return (
                  <div
                    key={pr.id}
                    className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-stone-50 group"
                  >
                    <a
                      href={pr.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 flex-1 min-w-0"
                    >
                      {isMerged
                        ? <GitMerge size={14} className="text-purple-500 shrink-0" />
                        : <GitPullRequest size={14} className="text-green-500 shrink-0" />
                      }
                      <span className="text-xs text-stone-400 shrink-0">{repoName}#{pr.number}</span>
                      <span className="text-sm text-stone-700 truncate flex-1">{pr.title}</span>
                      {source && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${
                          source === "branch"
                            ? "bg-blue-50  text-blue-600  "
                            : "bg-stone-100  text-stone-500  "
                        }`}>
                          {source}
                        </span>
                      )}
                      {pr.user && (
                        <span className="text-xs text-stone-400">{pr.user.login}</span>
                      )}
                      <ExternalLink size={12} className="text-stone-300 opacity-0 group-hover:opacity-100 shrink-0" />
                    </a>
                    {isManual && (
                      <button
                        type="button"
                        onClick={() => unlinkPRMut.mutate({ featureId: feature.id, prRepo: pr.repo, prNumber: pr.number })}
                        className="text-stone-300 hover:text-red-500 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        title="Unlink PR"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {!prsLoading && (!linkedPRs || linkedPRs.length === 0) && !showLinkPR && (
              <div className="text-xs text-stone-400">No linked PRs</div>
            )}
          </div>

          {/* Status History Timeline */}
          {draft.statusHistory && draft.statusHistory.length > 0 && (
            <div>
              <span className="text-xs text-stone-500 block mb-2">History</span>
              <div className="relative pl-4 space-y-2">
                <div className="absolute left-[5px] top-1.5 bottom-1.5 w-px bg-stone-200" />
                {draft.statusHistory.map((entry, i) => {
                  const dotColor = SHARED_STATUS_COLORS[entry.status as keyof typeof SHARED_STATUS_COLORS] ?? "bg-stone-400";
                  const label = SHARED_STATUS_LABELS[entry.status as keyof typeof SHARED_STATUS_LABELS] ?? "Future";
                  const date = new Date(entry.timestamp);
                  const ago = formatTimeAgo(date);
                  return (
                    <div key={i} className="relative flex items-center gap-2">
                      <div className={`absolute -left-4 w-2.5 h-2.5 rounded-full ${dotColor} ring-2 ring-white  `} />
                      <span className="text-xs font-medium text-stone-700">{label}</span>
                      <span className="text-xs text-stone-400">
                        {date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}{" "}
                        {date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                      </span>
                      <span className="text-xs text-stone-300">{ago}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Status footer */}
          <div className="flex items-center gap-2 text-xs text-stone-400 pt-1">
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ${
                SHARED_STATUS_COLORS[draft.status] ?? "bg-stone-300"
              }`}
            />
            {SHARED_STATUS_LABELS[draft.status] ?? "Future"}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Time Ago ----------

function formatTimeAgo(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

