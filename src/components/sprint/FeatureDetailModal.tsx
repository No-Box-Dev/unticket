import { useState, useRef, useEffect, useCallback } from "react";
import { X, ExternalLink, FileText, Pencil, Save, Plus, Loader2 } from "lucide-react";
import Markdown from "react-markdown";
import { PriorityTag } from "./PriorityTag";
import { AssignDropdown } from "./AssignDropdown";
import { PointsBadge } from "./PointsSelect";
import { RoleSection } from "./RoleSection";
import { useSubIssues, useCreateSubIssue, useToggleSubIssue, useDeleteSubIssue, useRolesWithTasks, useCreateRole, useDeleteRole, useCreateTask } from "@/hooks/useConfigRepo";
import type { Feature, Priority } from "@/lib/types";

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
  const [newRoleText, setNewRoleText] = useState("");
  const [newRoleAssignee, setNewRoleAssignee] = useState("");
  const [newTaskText, setNewTaskText] = useState("");

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

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const save = useCallback((next: Feature) => {
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
    clearTimeout(debounceRef.current);
    onUpdate({ ...draft });
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
          <div className="flex items-center gap-4">
            <div>
              <span className="text-xs text-stone-500 dark:text-neutral-400 block mb-1">Sprint</span>
              <span className="text-sm text-stone-700 dark:text-neutral-300">{draft.sprint ?? "Backlog"}</span>
            </div>
            <div>
              <span className="text-xs text-stone-500 dark:text-neutral-400 block mb-1">Priority</span>
              <PriorityTag
                priority={draft.priority ?? "none"}
                onChange={(priority: Priority) => update({ priority })}
              />
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

          {/* Status History Timeline */}
          {draft.statusHistory && draft.statusHistory.length > 0 && (
            <div>
              <span className="text-xs text-stone-500 dark:text-neutral-400 block mb-2">History</span>
              <div className="relative pl-4 space-y-2">
                <div className="absolute left-[5px] top-1.5 bottom-1.5 w-px bg-stone-200 dark:bg-white/[0.1]" />
                {draft.statusHistory.map((entry, i) => {
                  const dotColor =
                    entry.status === "production"
                      ? "bg-green-500"
                      : entry.status === "demo"
                        ? "bg-amber-500"
                        : entry.status === "plan"
                          ? "bg-brand"
                          : "bg-stone-400";
                  const label =
                    entry.status === "production" ? "Production"
                    : entry.status === "demo" ? "Demo"
                    : entry.status === "plan" ? "Plan"
                    : "Future";
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
                draft.status === "production"
                  ? "bg-green-500"
                  : draft.status === "demo"
                    ? "bg-amber-500"
                    : draft.status === "plan"
                      ? "bg-brand"
                      : "bg-stone-300"
              }`}
            />
            {draft.status === "production" ? "Production" : draft.status === "demo" ? "Demo" : draft.status === "plan" ? "Plan" : "Future"}
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

