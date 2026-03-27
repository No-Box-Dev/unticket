import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, ExternalLink, FileText, Pencil, Save, Plus, Loader2, GitPullRequest, GitMerge, Search, Link2 } from "lucide-react";
import Markdown from "react-markdown";
import { AssignDropdown } from "./AssignDropdown";
import { PointsBadge } from "./PointsSelect";
import { RoleSection } from "./RoleSection";
import { useSubIssues, useCreateSubIssue, useToggleSubIssue, useDeleteSubIssue, useRolesWithTasks, useCreateRole, useDeleteRole, useCreateTask, useUpdateTaskPoints, useUpdateTaskTitle } from "@/hooks/useConfigRepo";
import { usePRsForFeature, useLinkPR, useUnlinkPR } from "@/hooks/useGitHub";
import { fetchAllPRs } from "@/lib/github";
import type { Feature } from "@/lib/types";

// ---------- Component ----------

interface FeatureDetailModalProps {
  feature: Feature;
  allPeople: string[];
  onClose: () => void;
  onUpdate: (updated: Feature) => void;
  sprintOptions?: { value: number | null; label: string }[];
}

export function FeatureDetailModal({ feature, allPeople, onClose, onUpdate, sprintOptions }: FeatureDetailModalProps) {
  const [draft, setDraft] = useState<Feature>({ ...feature });
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [newRoleText, setNewRoleText] = useState("");
  const [newRoleAssignee, setNewRoleAssignee] = useState("");
  const [newTaskText, setNewTaskText] = useState("");
  const [showLinkPR, setShowLinkPR] = useState(false);
  const [prSearch, setPrSearch] = useState("");
  const [prRepoFilter, setPrRepoFilter] = useState("");
  const [prCreatorFilter, setPrCreatorFilter] = useState("");

  // Sub-issues (legacy flat tasks)
  const { data: subIssues, isLoading: subIssuesLoading } = useSubIssues(feature.id);
  const createSubIssueMut = useCreateSubIssue();
  const toggleSubIssueMut = useToggleSubIssue();
  const deleteSubIssueMut = useDeleteSubIssue();

  // Roles + tasks hierarchy
  const { data: rolesWithTasks, isLoading: rolesLoading } = useRolesWithTasks(feature.id);
  const createRoleMut = useCreateRole();
  const deleteRoleMut = useDeleteRole();
  const createTaskMut = useCreateTask();
  const updateTaskPointsMut = useUpdateTaskPoints();
  const updateTaskTitleMut = useUpdateTaskTitle();

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

  // Plan is now just the issue body (no more inline ## Tasks parsing)
  const plan = draft.plan ?? "";

  // Roles data
  const roles = rolesWithTasks ?? [];
  const roleNumbers = new Set(roles.map((r) => r.role.number));

  // Legacy flat tasks (sub-issues that are NOT roles)
  const legacyTasks = (subIssues ?? []).filter((s) => !roleNumbers.has(s.number));

  // Compute total points from all role tasks
  const totalPoints = roles.reduce((sum, r) => sum + r.totalPoints, 0);
  const donePoints = roles.reduce((sum, r) => sum + r.donePoints, 0);

  // Task counts from roles
  const allRoleTasks = roles.flatMap((r) => r.tasks);
  const totalTaskCount = allRoleTasks.length + legacyTasks.length;
  const doneTaskCount = allRoleTasks.filter((t) => t.state === "closed").length
    + legacyTasks.filter((t) => t.state === "closed").length;

  function addRole() {
    const text = newRoleText.trim();
    if (!text) return;
    createRoleMut.mutate(
      { featureId: feature.id, title: text, assignee: newRoleAssignee || undefined },
      { onError: (err) => console.error("[unticket.ai] createRole failed:", err) },
    );
    setNewRoleText("");
    setNewRoleAssignee("");
  }

  function addLegacyTask() {
    const text = newTaskText.trim();
    if (!text) return;
    createSubIssueMut.mutate({ parentIssueNumber: feature.id, title: text });
    setNewTaskText("");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={handleClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="bg-white dark:bg-dark-raised rounded-xl shadow-xl w-full max-w-3xl mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100 dark:border-white/[0.06]">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <input
              value={draft.title}
              onChange={(e) => update({ title: e.target.value }, true)}
              className="text-lg font-semibold text-stone-800 dark:text-neutral-200 bg-transparent border-none outline-none focus:ring-0 w-full"
            />
            {draft.url && (
              <a
                href={draft.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="View issue on GitHub"
                className="shrink-0 text-stone-400 dark:text-neutral-500 hover:text-brand flex items-center gap-1 text-xs"
                title="View issue on GitHub"
              >
                <ExternalLink size={14} aria-hidden="true" />
              </a>
            )}
          </div>
          <button onClick={handleClose} className="text-stone-400 dark:text-neutral-500 hover:text-stone-600 dark:hover:text-neutral-400 cursor-pointer ml-2">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-5">
          {/* Meta row */}
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <span className="text-xs text-stone-500 dark:text-neutral-400 block mb-1">Sprint</span>
              {sprintOptions ? (
                <select
                  value={draft.sprint ?? ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    const sprint = val === "" ? null : Number(val);
                    const status = sprint === null ? "future" : (draft.status === "future" ? "plan" : draft.status);
                    update({ sprint, status });
                  }}
                  className="px-2.5 py-1.5 rounded-md border border-stone-200 dark:border-white/[0.06] bg-white dark:bg-dark-raised text-xs text-stone-700 dark:text-neutral-300 focus:outline-none focus:border-brand cursor-pointer"
                >
                  {sprintOptions.map((opt) => (
                    <option key={opt.value ?? "backlog"} value={opt.value ?? ""}>{opt.label}</option>
                  ))}
                </select>
              ) : (
                <span className="text-sm text-stone-700 dark:text-neutral-300">{draft.sprint ?? "Backlog"}</span>
              )}
            </div>
            <div>
              <span className="text-xs text-stone-500 dark:text-neutral-400 block mb-1">Points</span>
              <PointsBadge points={donePoints} total={totalPoints} size="md" />
            </div>
            <div>
              <span className="text-xs text-stone-500 dark:text-neutral-400 block mb-1">Owners</span>
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
              <span className="text-xs text-stone-500 dark:text-neutral-400">Plan</span>
              <div className="flex items-center gap-2">
                {draft.url && (
                  <a
                    href={draft.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-stone-400 dark:text-neutral-500 hover:text-brand flex items-center gap-1"
                    title="View on GitHub"
                  >
                    <ExternalLink size={12} />
                  </a>
                )}
                {!editMode && (
                  <button
                    onClick={() => { setEditContent(plan); setEditMode(true); }}
                    className="text-xs text-stone-400 dark:text-neutral-500 hover:text-brand flex items-center gap-1 cursor-pointer"
                  >
                    <Pencil size={12} />
                    Edit
                  </button>
                )}
              </div>
            </div>

            {!editMode && !plan && totalTaskCount === 0 && roles.length === 0 && (
              <div className="rounded-lg border border-dashed border-stone-200 dark:border-white/[0.06] bg-stone-50 dark:bg-white/[0.04] px-4 py-8 text-center text-sm text-stone-400 dark:text-neutral-500">
                <FileText size={20} className="mx-auto mb-2 text-stone-300 dark:text-neutral-600" />
                No plan yet.
                <br />
                <button
                  onClick={() => { setEditContent(""); setEditMode(true); }}
                  className="mt-2 px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand/90 cursor-pointer"
                >
                  Create Plan
                </button>
              </div>
            )}

            {!editMode && plan && (
              <div className="rounded-lg border border-stone-200 dark:border-white/[0.06] bg-stone-50 dark:bg-white/[0.04] px-4 py-3 text-sm text-stone-700 dark:text-neutral-300 overflow-y-auto max-h-[40vh] prose prose-sm prose-stone dark:prose-invert max-w-none">
                <Markdown>{plan}</Markdown>
              </div>
            )}

            {editMode && (
              <div className="space-y-2">
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full rounded-lg border border-stone-300 dark:border-white/[0.1] bg-white dark:bg-dark-raised px-4 py-3 text-sm text-stone-700 dark:text-neutral-300 font-mono whitespace-pre-wrap focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand resize-y min-h-[200px] max-h-[50vh]"
                  rows={12}
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      update({ plan: editContent });
                      setEditMode(false);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand/90 cursor-pointer"
                  >
                    <Save size={12} />
                    Save
                  </button>
                  <button
                    onClick={() => setEditMode(false)}
                    className="px-3 py-1.5 rounded-lg border border-stone-200 dark:border-white/[0.06] text-xs text-stone-600 dark:text-neutral-400 hover:bg-stone-50 dark:hover:bg-white/[0.06] cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Roles & Tasks */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-stone-500 dark:text-neutral-400">
                Roles & Tasks
                {totalTaskCount > 0 && (
                  <span className="text-stone-400 dark:text-neutral-500 ml-1">
                    ({doneTaskCount}/{totalTaskCount})
                  </span>
                )}
              </span>
              {(subIssuesLoading || rolesLoading) && <Loader2 size={12} className="animate-spin text-stone-400 dark:text-neutral-500" />}
            </div>

            {/* Progress bar */}
            {totalTaskCount > 0 && (
              <div className="h-1.5 bg-stone-100 dark:bg-dark-overlay rounded-full mb-3 overflow-hidden">
                <div
                  className="h-full bg-brand rounded-full transition-all"
                  style={{ width: `${(doneTaskCount / totalTaskCount) * 100}%` }}
                />
              </div>
            )}

            {/* Role sections */}
            <div className="space-y-2">
              {roles.map(({ role, tasks: roleTasks, totalPoints: rPts, donePoints: rDone }) => (
                <RoleSection
                  key={role.id}
                  role={role}
                  tasks={roleTasks}
                  totalPoints={rPts}
                  donePoints={rDone}
                  onToggleTask={(task) => toggleSubIssueMut.mutate(task)}
                  onDeleteTask={(task) => deleteSubIssueMut.mutate({ parentIssueNumber: role.number, subIssueNumber: task.number })}
                  onUpdateTaskPoints={(task, points) => updateTaskPointsMut.mutate({ taskNumber: task.number, points })}
                  onUpdateTaskTitle={(task, newTitle) => updateTaskTitleMut.mutate({ taskNumber: task.number, featureId: feature.id, title: newTitle })}
                  onAddTask={(title, points) => createTaskMut.mutate({ roleNumber: role.number, featureId: feature.id, title, points, assignee: role.assignee ?? undefined })}
                  onDeleteRole={() => deleteRoleMut.mutate({ featureId: feature.id, roleNumber: role.number })}
                  isAdding={createTaskMut.isPending}
                />
              ))}
            </div>

            {/* Legacy flat tasks (sub-issues without role) */}
            {legacyTasks.length > 0 && (
              <div className="mt-3">
                <span className="text-[10px] text-stone-400 dark:text-neutral-500 uppercase tracking-wider">Ungrouped Tasks</span>
                <div className="space-y-1 mt-1">
                  {legacyTasks.map((task) => (
                    <div key={task.id} className="group flex items-center gap-2 py-1 px-1 rounded hover:bg-stone-50 dark:hover:bg-white/[0.06]">
                      <button
                        type="button"
                        onClick={() => toggleSubIssueMut.mutate(task)}
                        className="text-stone-400 dark:text-neutral-500 hover:text-brand cursor-pointer shrink-0"
                      >
                        {task.state === "closed"
                          ? <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-brand"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                          : <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>
                        }
                      </button>
                      <span className={`text-sm flex-1 ${task.state === "closed" ? "line-through text-stone-400 dark:text-neutral-500" : "text-stone-700 dark:text-neutral-300"}`}>
                        {task.title}
                      </span>
                      <button
                        type="button"
                        onClick={() => deleteSubIssueMut.mutate({ parentIssueNumber: feature.id, subIssueNumber: task.number })}
                        className="text-stone-300 dark:text-neutral-600 hover:text-red-500 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>

                {/* Add ungrouped task */}
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="text"
                    value={newTaskText}
                    onChange={(e) => setNewTaskText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addLegacyTask()}
                    placeholder="Add task..."
                    className="flex-1 px-2 py-1 rounded border border-stone-200 dark:border-white/[0.06] bg-white dark:bg-dark-raised text-sm dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
                  />
                  <button
                    type="button"
                    onClick={addLegacyTask}
                    disabled={!newTaskText.trim() || createSubIssueMut.isPending}
                    className="px-2 py-1 rounded bg-brand text-white text-xs font-medium hover:bg-brand/90 disabled:opacity-50 cursor-pointer"
                  >
                    {createSubIssueMut.isPending ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                  </button>
                </div>
              </div>
            )}

            {/* Add role */}
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <input
                type="text"
                value={newRoleText}
                onChange={(e) => setNewRoleText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addRole()}
                placeholder="Add a role..."
                className="flex-1 min-w-[120px] px-2.5 py-1.5 rounded-lg border border-stone-200 dark:border-white/[0.06] bg-white dark:bg-dark-raised text-sm dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
              />
              <select
                value={newRoleAssignee}
                onChange={(e) => setNewRoleAssignee(e.target.value)}
                className="px-2 py-1.5 rounded-lg border border-stone-200 dark:border-white/[0.06] bg-white dark:bg-dark-raised text-xs text-stone-600 dark:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-brand/30 cursor-pointer"
              >
                <option value="">Assignee</option>
                {allPeople.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <button
                type="button"
                aria-label="Add role"
                onClick={addRole}
                disabled={!newRoleText.trim() || createRoleMut.isPending}
                className="px-2.5 py-1.5 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand/90 disabled:opacity-50 cursor-pointer flex items-center gap-1"
              >
                {createRoleMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                Role
              </button>
              {createRoleMut.isError && (
                <span className="text-xs text-red-500 w-full">
                  Failed to create role: {(createRoleMut.error as any)?.message ?? "Unknown error"}
                </span>
              )}
            </div>
          </div>

          {/* Linked PRs */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="text-xs text-stone-500 dark:text-neutral-400">
                Linked PRs
                {linkedPRs && linkedPRs.length > 0 && (
                  <span className="text-stone-400 dark:text-neutral-500 ml-1">({linkedPRs.length})</span>
                )}
              </span>
              {prsLoading && <Loader2 size={12} className="animate-spin text-stone-400 dark:text-neutral-500" />}
              <button
                type="button"
                onClick={() => setShowLinkPR(!showLinkPR)}
                className="text-stone-400 dark:text-neutral-500 hover:text-brand cursor-pointer ml-auto"
                title="Link a PR"
              >
                <Plus size={14} />
              </button>
            </div>

            {/* Link PR dropdown */}
            {showLinkPR && (
              <div className="mb-2 rounded-lg border border-stone-200 dark:border-white/[0.06] bg-white dark:bg-dark-raised overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-stone-100 dark:border-white/[0.06]">
                  <Search size={14} className="text-stone-400 dark:text-neutral-500 shrink-0" />
                  <input
                    type="text"
                    value={prSearch}
                    onChange={(e) => setPrSearch(e.target.value)}
                    placeholder="Search PRs by title..."
                    className="flex-1 text-sm bg-transparent border-none outline-none dark:text-neutral-100"
                    autoFocus
                  />
                </div>
                {/* Repo + Creator filters */}
                <div className="flex items-center gap-2 px-3 py-1.5 border-b border-stone-100 dark:border-white/[0.06]">
                  <select
                    value={prRepoFilter}
                    onChange={(e) => setPrRepoFilter(e.target.value)}
                    className="text-xs px-2 py-1 rounded border border-stone-200 dark:border-white/[0.06] bg-white dark:bg-dark-raised text-stone-600 dark:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-brand/30 cursor-pointer"
                  >
                    <option value="">All repos</option>
                    {availableRepos.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <select
                    value={prCreatorFilter}
                    onChange={(e) => setPrCreatorFilter(e.target.value)}
                    className="text-xs px-2 py-1 rounded border border-stone-200 dark:border-white/[0.06] bg-white dark:bg-dark-raised text-stone-600 dark:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-brand/30 cursor-pointer"
                  >
                    <option value="">All creators</option>
                    {availableCreators.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="max-h-[200px] overflow-y-auto">
                  {filteredLinkablePRs.length === 0 ? (
                    <div className="px-3 py-4 text-center text-xs text-stone-400 dark:text-neutral-500">
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
                      className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-stone-50 dark:hover:bg-white/[0.06] text-left cursor-pointer"
                    >
                      <Link2 size={12} className="text-stone-400 dark:text-neutral-500 shrink-0" />
                      <span className="text-xs text-stone-400 dark:text-neutral-500 shrink-0">{pr.repo}#{pr.number}</span>
                      <span className="text-sm text-stone-700 dark:text-neutral-300 truncate flex-1">{pr.title}</span>
                      {pr.user && <span className="text-xs text-stone-400 dark:text-neutral-500 shrink-0">{pr.user.login}</span>}
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
                    className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-stone-50 dark:hover:bg-white/[0.06] group"
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
                      <span className="text-xs text-stone-400 dark:text-neutral-500 shrink-0">{repoName}#{pr.number}</span>
                      <span className="text-sm text-stone-700 dark:text-neutral-300 truncate flex-1">{pr.title}</span>
                      {source && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${
                          source === "branch"
                            ? "bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400"
                            : "bg-stone-100 dark:bg-white/[0.06] text-stone-500 dark:text-neutral-400"
                        }`}>
                          {source}
                        </span>
                      )}
                      {pr.user && (
                        <span className="text-xs text-stone-400 dark:text-neutral-500">{pr.user.login}</span>
                      )}
                      <ExternalLink size={12} className="text-stone-300 dark:text-neutral-600 opacity-0 group-hover:opacity-100 shrink-0" />
                    </a>
                    {isManual && (
                      <button
                        type="button"
                        onClick={() => unlinkPRMut.mutate({ featureId: feature.id, prRepo: pr.repo, prNumber: pr.number })}
                        className="text-stone-300 dark:text-neutral-600 hover:text-red-500 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
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
              <div className="text-xs text-stone-400 dark:text-neutral-500">No linked PRs</div>
            )}
          </div>

          {/* Status History Timeline */}
          {draft.statusHistory && draft.statusHistory.length > 0 && (
            <div>
              <span className="text-xs text-stone-500 dark:text-neutral-400 block mb-2">History</span>
              <div className="relative pl-4 space-y-2">
                <div className="absolute left-[5px] top-1.5 bottom-1.5 w-px bg-stone-200 dark:bg-white/[0.1]" />
                {draft.statusHistory.map((entry, i) => {
                  const STATUS_COLORS: Record<string, string> = {
                    plan: "bg-brand", in_progress: "bg-amber-500", demo: "bg-purple-500",
                    tested: "bg-cyan-500", production: "bg-green-500", future: "bg-stone-400",
                  };
                  const STATUS_LABELS: Record<string, string> = {
                    plan: "Plan", in_progress: "In Progress", demo: "Demo",
                    tested: "Tested", production: "In Production", future: "Future",
                  };
                  const dotColor = STATUS_COLORS[entry.status] ?? "bg-stone-400";
                  const label = STATUS_LABELS[entry.status] ?? "Future";
                  const date = new Date(entry.timestamp);
                  const ago = formatTimeAgo(date);
                  return (
                    <div key={i} className="relative flex items-center gap-2">
                      <div className={`absolute -left-4 w-2.5 h-2.5 rounded-full ${dotColor} ring-2 ring-white dark:ring-white/[0.06]`} />
                      <span className="text-xs font-medium text-stone-700 dark:text-neutral-300">{label}</span>
                      <span className="text-xs text-stone-400 dark:text-neutral-500">
                        {date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}{" "}
                        {date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                      </span>
                      <span className="text-xs text-stone-300 dark:text-neutral-600">{ago}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Status footer */}
          <div className="flex items-center gap-2 text-xs text-stone-400 dark:text-neutral-500 pt-1">
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ${
                ({ plan: "bg-brand", in_progress: "bg-amber-500", demo: "bg-purple-500", tested: "bg-cyan-500", production: "bg-green-500", future: "bg-stone-300" } as Record<string, string>)[draft.status] ?? "bg-stone-300"
              }`}
            />
            {({ plan: "Plan", in_progress: "In Progress", demo: "Demo", tested: "Tested", production: "In Production", future: "Future" } as Record<string, string>)[draft.status] ?? "Future"}
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

