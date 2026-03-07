import { useState, useRef, useEffect, useCallback } from "react";
import { X, ExternalLink, FileText, Pencil, Save, Plus, Check, Square, CheckSquare } from "lucide-react";
import Markdown from "react-markdown";
import { EffortTag } from "./EffortTag";
import { PriorityTag } from "./PriorityTag";
import { AssignDropdown } from "./AssignDropdown";
import type { Feature, Effort, Priority, StatusHistoryEntry } from "@/lib/types";

// ---------- Task parsing ----------

interface Task {
  text: string;
  done: boolean;
  assignee?: string;
}

const TASK_RE = /^- \[([ xX])\] (.+)$/;
const ASSIGNEE_RE = /@(\S+)$/;

function parseTasks(body: string): { plan: string; tasks: Task[] } {
  const lines = body.split("\n");
  const tasksIdx = lines.findIndex((l) => /^##\s+Tasks?\s*$/i.test(l));

  if (tasksIdx === -1) {
    return { plan: body, tasks: [] };
  }

  const planLines = lines.slice(0, tasksIdx).join("\n").trimEnd();
  const tasks: Task[] = [];

  for (let i = tasksIdx + 1; i < lines.length; i++) {
    const match = lines[i].match(TASK_RE);
    if (!match) {
      if (lines[i].trim() === "") continue;
      // Non-task line after tasks section — stop parsing tasks
      if (lines[i].startsWith("#")) break;
      continue;
    }
    const done = match[1] !== " ";
    let text = match[2].trim();
    let assignee: string | undefined;
    const assigneeMatch = text.match(ASSIGNEE_RE);
    if (assigneeMatch) {
      assignee = assigneeMatch[1];
      text = text.slice(0, -assigneeMatch[0].length).trim();
    }
    tasks.push({ text, done, assignee });
  }

  return { plan: planLines, tasks };
}

function serializeBody(plan: string, tasks: Task[]): string {
  const parts = [plan.trimEnd()];
  if (tasks.length > 0) {
    parts.push("");
    parts.push("## Tasks");
    for (const t of tasks) {
      const check = t.done ? "x" : " ";
      const assignee = t.assignee ? ` @${t.assignee}` : "";
      parts.push(`- [${check}] ${t.text}${assignee}`);
    }
  }
  return parts.join("\n");
}

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

  const body = draft.plan ?? "";
  const { plan, tasks } = parseTasks(body);

  function updateTasks(newTasks: Task[]) {
    update({ plan: serializeBody(plan, newTasks) });
  }

  function toggleTask(index: number) {
    const next = tasks.map((t, i) => (i === index ? { ...t, done: !t.done } : t));
    updateTasks(next);
  }

  function setTaskAssignee(index: number, assignee: string | undefined) {
    const next = tasks.map((t, i) => (i === index ? { ...t, assignee } : t));
    updateTasks(next);
  }

  function deleteTask(index: number) {
    updateTasks(tasks.filter((_, i) => i !== index));
  }

  function addTask() {
    const text = newTaskText.trim();
    if (!text) return;
    const newTasks = [...tasks, { text, done: false }];
    update({ plan: serializeBody(plan, newTasks) });
    setNewTaskText("");
  }

  const doneCount = tasks.filter((t) => t.done).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={handleClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-3xl mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <input
              value={draft.title}
              onChange={(e) => update({ title: e.target.value }, true)}
              className="text-lg font-semibold text-stone-800 bg-transparent border-none outline-none focus:ring-0 w-full"
            />
            {draft.url && (
              <a
                href={draft.url}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-stone-400 hover:text-brand flex items-center gap-1 text-xs"
                title="View issue on GitHub"
              >
                <ExternalLink size={14} />
              </a>
            )}
          </div>
          <button onClick={handleClose} className="text-stone-400 hover:text-stone-600 cursor-pointer ml-2">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-5">
          {/* Meta row */}
          <div className="flex items-center gap-4">
            <div>
              <span className="text-xs text-stone-500 block mb-1">Sprint</span>
              <span className="text-sm text-stone-700">{draft.sprint ?? "Backlog"}</span>
            </div>
            <div>
              <span className="text-xs text-stone-500 block mb-1">Priority</span>
              <PriorityTag
                priority={draft.priority ?? "none"}
                onChange={(priority: Priority) => update({ priority })}
              />
            </div>
            <div>
              <span className="text-xs text-stone-500 block mb-1">Effort</span>
              <EffortTag
                effort={draft.effort}
                onChange={(effort: Effort) => update({ effort })}
              />
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
                    className="text-xs text-stone-400 hover:text-brand flex items-center gap-1"
                    title="View on GitHub"
                  >
                    <ExternalLink size={12} />
                  </a>
                )}
                {!editMode && (
                  <button
                    onClick={() => { setEditContent(plan); setEditMode(true); }}
                    className="text-xs text-stone-400 hover:text-brand flex items-center gap-1 cursor-pointer"
                  >
                    <Pencil size={12} />
                    Edit
                  </button>
                )}
              </div>
            </div>

            {!editMode && !plan && tasks.length === 0 && (
              <div className="rounded-lg border border-dashed border-stone-200 bg-stone-50 px-4 py-8 text-center text-sm text-stone-400">
                <FileText size={20} className="mx-auto mb-2 text-stone-300" />
                No plan yet.
                <br />
                <button
                  onClick={() => { setEditContent(""); setEditMode(true); }}
                  className="mt-2 px-3 py-1.5 rounded-md bg-brand text-white text-xs font-medium hover:bg-brand/90 cursor-pointer"
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
                  className="w-full rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm text-stone-700 font-mono whitespace-pre-wrap focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand resize-y min-h-[200px] max-h-[50vh]"
                  rows={12}
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      update({ plan: serializeBody(editContent, tasks) });
                      setEditMode(false);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-brand text-white text-xs font-medium hover:bg-brand/90 cursor-pointer"
                  >
                    <Save size={12} />
                    Save
                  </button>
                  <button
                    onClick={() => setEditMode(false)}
                    className="px-3 py-1.5 rounded-md border border-stone-200 text-xs text-stone-600 hover:bg-stone-50 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Tasks */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-stone-500">
                Tasks
                {tasks.length > 0 && (
                  <span className="text-stone-400 ml-1">
                    ({doneCount}/{tasks.length})
                  </span>
                )}
              </span>
            </div>

            {/* Progress bar */}
            {tasks.length > 0 && (
              <div className="h-1.5 bg-stone-100 rounded-full mb-3 overflow-hidden">
                <div
                  className="h-full bg-brand rounded-full transition-all"
                  style={{ width: `${(doneCount / tasks.length) * 100}%` }}
                />
              </div>
            )}

            {/* Task list */}
            <div className="space-y-1">
              {tasks.map((task, i) => (
                <div key={i} className="group flex items-center gap-2 py-1 px-1 rounded hover:bg-stone-50">
                  <button
                    type="button"
                    aria-label={task.done ? "Mark task as not done" : "Mark task as done"}
                    onClick={() => toggleTask(i)}
                    className="text-stone-400 hover:text-brand cursor-pointer shrink-0"
                  >
                    {task.done ? (
                      <CheckSquare size={16} className="text-brand" />
                    ) : (
                      <Square size={16} />
                    )}
                  </button>
                  <span className={`text-sm flex-1 ${task.done ? "line-through text-stone-400" : "text-stone-700"}`}>
                    {task.text}
                  </span>
                  <TaskAssignee
                    assignee={task.assignee}
                    allPeople={allPeople}
                    onChange={(a) => setTaskAssignee(i, a)}
                  />
                  <button
                    type="button"
                    aria-label={`Delete task: ${task.text}`}
                    onClick={() => deleteTask(i)}
                    className="text-stone-300 hover:text-red-500 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X size={14} />
                  </button>
                </div>
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
                className="flex-1 px-2.5 py-1.5 rounded-md border border-stone-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
              />
              <button
                type="button"
                aria-label="Add task"
                onClick={addTask}
                disabled={!newTaskText.trim()}
                className="px-2.5 py-1.5 rounded-md bg-brand text-white text-xs font-medium hover:bg-brand/90 disabled:opacity-40 cursor-pointer flex items-center gap-1"
              >
                <Plus size={14} />
              </button>
            </div>
          </div>

          {/* Status History Timeline */}
          {draft.statusHistory && draft.statusHistory.length > 0 && (
            <div>
              <span className="text-xs text-stone-500 block mb-2">History</span>
              <div className="relative pl-4 space-y-2">
                <div className="absolute left-[5px] top-1.5 bottom-1.5 w-px bg-stone-200" />
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
                      <div className={`absolute -left-4 w-2.5 h-2.5 rounded-full ${dotColor} ring-2 ring-white`} />
                      <span className="text-xs font-medium text-stone-700">{label}</span>
                      <span className="text-[10px] text-stone-400">
                        {date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}{" "}
                        {date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                      </span>
                      <span className="text-[10px] text-stone-300">{ago}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Status footer */}
          <div className="flex items-center gap-2 text-[10px] text-stone-400 pt-1">
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

// ---------- Task Assignee Picker ----------

function TaskAssignee({
  assignee,
  allPeople,
  onChange,
}: {
  assignee?: string;
  allPeople: string[];
  onChange: (assignee: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
            : "text-stone-300 hover:text-stone-500 hover:bg-stone-100"
        }`}
      >
        {assignee ? `@${assignee}` : "assign"}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white border border-stone-200 rounded-lg shadow-lg z-10 w-40 max-h-48 overflow-y-auto">
          <button
            onClick={() => { onChange(undefined); setOpen(false); }}
            className="w-full text-left px-3 py-1.5 text-xs text-stone-400 hover:bg-stone-50 cursor-pointer"
          >
            Unassign
          </button>
          {allPeople.map((p) => (
            <button
              key={p}
              onClick={() => { onChange(p); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-stone-50 cursor-pointer flex items-center gap-1.5 ${
                p === assignee ? "text-brand font-medium" : "text-stone-700"
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
