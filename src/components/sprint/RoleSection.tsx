import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, X, Square, CheckSquare, Loader2, Trash2 } from "lucide-react";
import type { SubIssue } from "@/lib/github-features";
import type { PersonRole } from "@/lib/types";

interface RoleSectionProps {
  role: PersonRole;
  tasks: SubIssue[];
  onToggleTask: (task: SubIssue) => void;
  onDeleteTask: (task: SubIssue) => void;
  onUpdateTaskTitle: (task: SubIssue, newTitle: string) => void;
  onAddTask: (title: string) => void;
  onDeleteRole: () => void;
  isAdding: boolean;
}

export function RoleSection({
  role,
  tasks,
  onToggleTask,
  onDeleteTask,
  onUpdateTaskTitle,
  onAddTask,
  onDeleteRole,
  isAdding,
}: RoleSectionProps) {
  const [expanded, setExpanded] = useState(true);
  const [newTaskText, setNewTaskText] = useState("");
  const doneCount = tasks.filter((t) => t.state === "closed").length;

  function addTask() {
    const text = newTaskText.trim();
    if (!text) return;
    onAddTask(text);
    setNewTaskText("");
  }

  return (
    <div className="border border-stone-200 rounded-lg overflow-hidden">
      {/* Role header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-stone-50 group">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="text-stone-400 cursor-pointer shrink-0"
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        {role.assignee && (
          <span className="text-xs font-medium text-accent bg-accent/10 px-1.5 py-0.5 rounded">
            @{role.assignee}
          </span>
        )}
        <span className="text-sm font-medium text-stone-700 flex-1 truncate">
          {role.title}
        </span>
        <span className="text-xs text-stone-400">
          {doneCount}/{tasks.length}
        </span>
        <button
          type="button"
          onClick={onDeleteRole}
          className="text-stone-300 hover:text-severity-high cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
          title="Remove role"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Tasks */}
      {expanded && (
        <div className="px-3 py-1.5 space-y-0.5">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onToggle={() => onToggleTask(task)}
              onDelete={() => onDeleteTask(task)}
              onUpdateTitle={(newTitle) => onUpdateTaskTitle(task, newTitle)}
            />
          ))}

          {/* Add task input */}
          <div className="flex items-center gap-2 pt-1 flex-wrap">
            <input
              type="text"
              value={newTaskText}
              onChange={(e) => setNewTaskText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTask()}
              placeholder="Add task..."
              className="flex-1 min-w-[120px] px-2 py-1 rounded border border-stone-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
            />
            <button
              type="button"
              onClick={addTask}
              disabled={!newTaskText.trim() || isAdding}
              className="px-2 py-1 rounded bg-accent text-white text-xs font-medium hover:bg-accent/90 disabled:opacity-50 cursor-pointer flex items-center gap-1"
            >
              {isAdding ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TaskRow({
  task,
  onToggle,
  onDelete,
  onUpdateTitle,
}: {
  task: SubIssue;
  onToggle: () => void;
  onDelete: () => void;
  onUpdateTitle: (newTitle: string) => void;
}) {
  const isDone = task.state === "closed";
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(task.title);

  function commitEdit() {
    const trimmed = editValue.trim();
    setEditing(false);
    if (trimmed && trimmed !== task.title) {
      onUpdateTitle(trimmed);
    } else {
      setEditValue(task.title);
    }
  }

  function cancelEdit() {
    setEditing(false);
    setEditValue(task.title);
  }

  return (
    <div className="group flex items-center gap-2 py-1 px-1 rounded hover:bg-stone-50">
      <button
        type="button"
        onClick={onToggle}
        className="text-stone-400 hover:text-accent cursor-pointer shrink-0"
      >
        {isDone ? <CheckSquare size={15} className="text-accent" /> : <Square size={15} />}
      </button>
      {editing ? (
        <input
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitEdit();
            if (e.key === "Escape") cancelEdit();
          }}
          autoFocus
          className="text-sm flex-1 px-1 py-0 rounded border border-accent/40 bg-white text-stone-700 focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
      ) : (
        <span
          className={`text-sm flex-1 cursor-text ${isDone ? "line-through text-stone-400  " : "text-stone-700  "}`}
          onClick={() => { setEditValue(task.title); setEditing(true); }}
        >
          {task.title}
        </span>
      )}
      {task.assignees.length > 0 && (
        <span className="text-xs text-accent bg-accent/10 px-1.5 py-0.5 rounded">
          @{task.assignees[0]}
        </span>
      )}
      <button
        type="button"
        onClick={onDelete}
        className="text-stone-300 hover:text-severity-high cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <X size={13} />
      </button>
    </div>
  );
}
