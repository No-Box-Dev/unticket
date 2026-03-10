import { useState, useRef, useEffect, useCallback } from "react";
import { X, ExternalLink, FileText, Pencil, Save, Plus, Check, Square, CheckSquare, Loader2 } from "lucide-react";
import Markdown from "react-markdown";
import { EffortTag } from "./EffortTag";
import { PriorityTag } from "./PriorityTag";
import { AssignDropdown } from "./AssignDropdown";
import { useSubIssues, useCreateSubIssue, useToggleSubIssue, useUpdateSubIssueAssignees, useDeleteSubIssue } from "@/hooks/useConfigRepo";
import type { Feature, Effort, Priority } from "@/lib/types";
import type { SubIssue } from "@/lib/github-features";

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
  const [newTaskText, setNewTaskText] = useState("");

  // Sub-issues
  const { data: subIssues, isLoading: subIssuesLoading } = useSubIssues(feature.id);
  const createSubIssueMut = useCreateSubIssue();
  const toggleSubIssueMut = useToggleSubIssue();
  const updateAssigneesMut = useUpdateSubIssueAssignees();
  const deleteSubIssueMut = useDeleteSubIssue();

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

  function addTask() {
    const text = newTaskText.trim();
    if (!text) return;
    createSubIssueMut.mutate({ parentIssueNumber: feature.id, title: text });
    setNewTaskText("");
  }

  const tasks = subIssues ?? [];
  const doneCount = tasks.filter((t) => t.state === "closed").length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={handleClose}>
      <div
        className="bg-white dark:bg-stone-900 rounded-xl shadow-xl w-full max-w-3xl mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100 dark:border-stone-800">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <input
              value={draft.title}
              onChange={(e) => update({ title: e.target.value }, true)}
              className="text-lg font-semibold text-stone-800 dark:text-stone-200 bg-transparent border-none outline-none focus:ring-0 w-full"
            />
            {draft.url && (
              <a
                href={draft.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="View issue on GitHub"
                className="shrink-0 text-stone-400 dark:text-stone-500 hover:text-brand flex items-center gap-1 text-xs"
                title="View issue on GitHub"
              >
                <ExternalLink size={14} aria-hidden="true" />
              </a>
            )}
          </div>
          <button onClick={handleClose} className="text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-400 cursor-pointer ml-2">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-5">
          {/* Meta row */}
          <div className="flex items-center gap-4">
            <div>
              <span className="text-xs text-stone-500 dark:text-stone-400 block mb-1">Sprint</span>
              <span className="text-sm text-stone-700 dark:text-stone-300">{draft.sprint ?? "Backlog"}</span>
            </div>
            <div>
              <span className="text-xs text-stone-500 dark:text-stone-400 block mb-1">Priority</span>
              <PriorityTag
                priority={draft.priority ?? "none"}
                onChange={(priority: Priority) => update({ priority })}
              />
            </div>
            <div>
              <span className="text-xs text-stone-500 dark:text-stone-400 block mb-1">Effort</span>
              <EffortTag
                effort={draft.effort}
                onChange={(effort: Effort) => update({ effort })}
              />
            </div>
            <div>
              <span className="text-xs text-stone-500 dark:text-stone-400 block mb-1">Owners</span>
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
              <span className="text-xs text-stone-500 dark:text-stone-400">Plan</span>
              <div className="flex items-center gap-2">
                {draft.url && (
                  <a
                    href={draft.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-stone-400 dark:text-stone-500 hover:text-brand flex items-center gap-1"
                    title="View on GitHub"
                  >
                    <ExternalLink size={12} />
                  </a>
                )}
                {!editMode && (
                  <button
                    onClick={() => { setEditContent(plan); setEditMode(true); }}
                    className="text-xs text-stone-400 dark:text-stone-500 hover:text-brand flex items-center gap-1 cursor-pointer"
                  >
                    <Pencil size={12} />
                    Edit
                  </button>
                )}
              </div>
            </div>

            {!editMode && !plan && tasks.length === 0 && (
              <div className="rounded-lg border border-dashed border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-800/50 px-4 py-8 text-center text-sm text-stone-400 dark:text-stone-500">
                <FileText size={20} className="mx-auto mb-2 text-stone-300 dark:text-stone-600" />
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
              <div className="rounded-lg border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-800/50 px-4 py-3 text-sm text-stone-700 dark:text-stone-300 overflow-y-auto max-h-[40vh] prose prose-sm prose-stone dark:prose-invert max-w-none">
                <Markdown>{plan}</Markdown>
              </div>
            )}

            {editMode && (
              <div className="space-y-2">
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full rounded-lg border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 px-4 py-3 text-sm text-stone-700 dark:text-stone-300 font-mono whitespace-pre-wrap focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand resize-y min-h-[200px] max-h-[50vh]"
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
                    className="px-3 py-1.5 rounded-lg border border-stone-200 dark:border-stone-800 text-xs text-stone-600 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-800/50 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Tasks (Sub-issues) */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-stone-500 dark:text-stone-400">
                Tasks
                {tasks.length > 0 && (
                  <span className="text-stone-400 dark:text-stone-500 ml-1">
                    ({doneCount}/{tasks.length})
                  </span>
                )}
              </span>
              {subIssuesLoading && <Loader2 size={12} className="animate-spin text-stone-400 dark:text-stone-500" />}
            </div>

            {/* Progress bar */}
            {tasks.length > 0 && (
              <div className="h-1.5 bg-stone-100 dark:bg-stone-800 rounded-full mb-3 overflow-hidden">
                <div
                  className="h-full bg-brand rounded-full transition-all"
                  style={{ width: `${(doneCount / tasks.length) * 100}%` }}
                />
              </div>
            )}

            {/* Task list */}
            <div className="space-y-1">
              {tasks.map((task) => (
                <SubIssueRow
                  key={task.id}
                  task={task}
                  allPeople={allPeople}
                  onToggle={() => toggleSubIssueMut.mutate(task)}
                  onAssign={(assignees) => updateAssigneesMut.mutate({ subIssueNumber: task.number, assignees })}
                  onDelete={() => deleteSubIssueMut.mutate({ parentIssueNumber: feature.id, subIssueNumber: task.number })}
                />
              ))}
            </div>

            {/* Add task */}
            <div className="flex items-center gap-2 mt-2">
              <input
                type="text"
                value={newTaskText}
                onChange={(e) => setNewTaskText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addTask()}
                placeholder="Add a task..."
                className="flex-1 px-2.5 py-1.5 rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 text-sm dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
              />
              <button
                type="button"
                aria-label="Add task"
                onClick={addTask}
                disabled={!newTaskText.trim() || createSubIssueMut.isPending}
                className="px-2.5 py-1.5 rounded-lg bg-brand text-white text-xs font-medium hover:bg-brand/90 disabled:opacity-50 cursor-pointer flex items-center gap-1"
              >
                {createSubIssueMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              </button>
            </div>
          </div>

          {/* Status History Timeline */}
          {draft.statusHistory && draft.statusHistory.length > 0 && (
            <div>
              <span className="text-xs text-stone-500 dark:text-stone-400 block mb-2">History</span>
              <div className="relative pl-4 space-y-2">
                <div className="absolute left-[5px] top-1.5 bottom-1.5 w-px bg-stone-200 dark:bg-stone-700" />
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
                      <div className={`absolute -left-4 w-2.5 h-2.5 rounded-full ${dotColor} ring-2 ring-white dark:ring-stone-900`} />
                      <span className="text-xs font-medium text-stone-700 dark:text-stone-300">{label}</span>
                      <span className="text-xs text-stone-400 dark:text-stone-500">
                        {date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}{" "}
                        {date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                      </span>
                      <span className="text-xs text-stone-300 dark:text-stone-600">{ago}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Status footer */}
          <div className="flex items-center gap-2 text-xs text-stone-400 dark:text-stone-500 pt-1">
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

// ---------- Sub-issue Row ----------

function SubIssueRow({
  task,
  allPeople,
  onToggle,
  onAssign,
  onDelete,
}: {
  task: SubIssue;
  allPeople: string[];
  onToggle: () => void;
  onAssign: (assignees: string[]) => void;
  onDelete: () => void;
}) {
  const isDone = task.state === "closed";

  return (
    <div className="group flex items-center gap-2 py-1 px-1 rounded hover:bg-stone-50 dark:hover:bg-stone-800/50">
      <button
        type="button"
        aria-label={isDone ? "Reopen task" : "Complete task"}
        onClick={onToggle}
        className="text-stone-400 dark:text-stone-500 hover:text-brand cursor-pointer shrink-0"
      >
        {isDone ? (
          <CheckSquare size={16} className="text-brand" />
        ) : (
          <Square size={16} />
        )}
      </button>
      <span className={`text-sm flex-1 ${isDone ? "line-through text-stone-400 dark:text-stone-500" : "text-stone-700 dark:text-stone-300"}`}>
        {task.title}
      </span>
      <TaskAssignee
        assignees={task.assignees}
        allPeople={allPeople}
        onChange={onAssign}
      />
      <button
        type="button"
        aria-label={`Delete task: ${task.title}`}
        onClick={onDelete}
        className="text-stone-300 dark:text-stone-600 hover:text-red-500 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <X size={14} />
      </button>
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

// ---------- Task Assignee Picker ----------

function TaskAssignee({
  assignees,
  allPeople,
  onChange,
}: {
  assignees: string[];
  allPeople: string[];
  onChange: (assignees: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const assignee = assignees[0];

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`text-xs px-1.5 py-0.5 rounded cursor-pointer ${
          assignee
            ? "bg-brand/10 text-brand hover:bg-brand/20"
            : "text-stone-300 dark:text-stone-600 hover:text-stone-500 dark:hover:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800"
        }`}
      >
        {assignee ? `@${assignee}` : "assign"}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-lg shadow-md z-10 w-40 max-h-48 overflow-y-auto">
          <button
            onClick={() => { onChange([]); setOpen(false); }}
            className="w-full text-left px-3 py-1.5 text-xs text-stone-400 dark:text-stone-500 hover:bg-stone-50 dark:hover:bg-stone-800/50 cursor-pointer"
          >
            Unassign
          </button>
          {allPeople.map((p) => (
            <button
              key={p}
              onClick={() => { onChange([p]); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-stone-50 dark:hover:bg-stone-800/50 cursor-pointer flex items-center gap-1.5 ${
                p === assignee ? "text-brand font-medium" : "text-stone-700 dark:text-stone-300"
              }`}
            >
              {p === assignee && <Check size={12} />}
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
