import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { useTodos, useSaveTodos, useFeatures } from "@/hooks/useConfigRepo";
import { useRepos } from "@/hooks/useGitHub";
import { fetchTodoPlanFile, todoPlanFilePath, saveTodoPlanFile } from "@/lib/config-repo";
import { broadcastError } from "@/lib/api";
import { Plus, X, Trash2, GitBranch, ExternalLink, FileText, Pencil, Save, Loader2 } from "lucide-react";
import { Spinner } from "@/components/Spinner";
import { cn } from "@/lib/cn";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import type { Todo, TodoStatus, Feature, FeatureStatus, RepoInfo } from "@/lib/types";

const STATUS_DOT: Record<FeatureStatus, string> = {
  plan: "bg-brand",
  demo: "bg-amber-500",
  production: "bg-green-500",
  future: "bg-stone-300",
};

const COLUMNS: { status: TodoStatus; label: string }[] = [
  { status: "backlog", label: "Backlog" },
  { status: "in_progress", label: "In Progress" },
  { status: "done", label: "Done" },
];

/** Migrate old todos that have `done` but no `status` */
function migrateTodo(t: Todo): Todo {
  if (t.status) return t;
  return { ...t, status: t.done ? "done" : "backlog" };
}

export function TodoTab() {
  const { user, selectedOrg } = useAuth();
  const { data: allTodos, isLoading } = useTodos();
  const { data: features } = useFeatures();
  const saveTodos = useSaveTodos();
  const [input, setInput] = useState("");
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<TodoStatus | null>(null);
  const [dragOverCardId, setDragOverCardId] = useState<string | null>(null);
  const dragOverCardIdRef = useRef<string | null>(null);
  const [detailTodo, setDetailTodo] = useState<Todo | null>(null);
  const { data: repos } = useRepos();

  const myTodos = useMemo(() => {
    if (!allTodos || !user) return [];
    return allTodos.filter((t) => t.owner === user.login).map(migrateTodo);
  }, [allTodos, user]);

  const columns = useMemo(() => {
    const grouped: Record<TodoStatus, Todo[]> = { backlog: [], in_progress: [], done: [] };
    for (const t of myTodos) grouped[t.status].push(t);
    return grouped;
  }, [myTodos]);

  const myFeatures = useMemo(() => {
    if (!features || !user) return [];
    return features.filter((f) => f.owners.includes(user.login) && f.status !== "future");
  }, [features, user]);

  const featureMap = useMemo(() => {
    const map = new Map<string, Feature>();
    for (const f of features ?? []) map.set(String(f.id), f);
    return map;
  }, [features]);

  function updateAll(next: Todo[]) {
    if (!allTodos) return;
    const others = allTodos.filter((t) => t.owner !== user!.login);
    saveTodos.mutate([...others, ...next]);
  }

  function updateTodo(id: string, patch: Partial<Todo>) {
    updateAll(myTodos.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  function addTodo() {
    const title = input.trim();
    if (!title || !user) return;
    const todo: Todo = {
      id: crypto.randomUUID(),
      title,
      owner: user.login,
      status: "backlog",
      createdAt: new Date().toISOString(),
      ...(selectedFeatureId ? { featureId: selectedFeatureId } : {}),
      ...(selectedRepo ? { repo: selectedRepo } : {}),
    };
    updateAll([...myTodos, todo]);
    setInput("");
    setSelectedFeatureId(null);
    setSelectedRepo(null);
  }

  function addFeatureTodo(feature: Feature) {
    if (!user) return;
    const todo: Todo = {
      id: crypto.randomUUID(),
      title: feature.title,
      owner: user.login,
      status: "backlog",
      createdAt: new Date().toISOString(),
      featureId: String(feature.id),
    };
    updateAll([...myTodos, todo]);
  }

  function deleteTodo(id: string) {
    updateAll(myTodos.filter((t) => t.id !== id));
  }

  function clearDone() {
    updateAll(myTodos.filter((t) => t.status !== "done"));
  }

  // --- Drag and drop ---
  const handleDragStart = useCallback((e: React.DragEvent, todo: Todo) => {
    e.dataTransfer.setData("text/plain", todo.id);
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetStatus: TodoStatus) => {
      e.preventDefault();
      const todoId = e.dataTransfer.getData("text/plain");
      const todo = myTodos.find((t) => t.id === todoId);
      const targetCardId = dragOverCardIdRef.current;

      setDragOverCol(null);
      setDragOverCardId(null);
      dragOverCardIdRef.current = null;

      if (!todo) return;

      const isSameColumn = todo.status === targetStatus;
      const hasTargetCard = targetCardId && targetCardId !== todoId;

      // Same column, no target card — nothing to do
      if (isSameColumn && !hasTargetCard) return;

      const updatedTodo = { ...todo, status: targetStatus };
      const withoutDragged = myTodos.filter((t) => t.id !== todoId);

      if (hasTargetCard) {
        const targetCard = withoutDragged.find((t) => t.id === targetCardId);
        if (targetCard?.status === targetStatus) {
          const targetIndex = withoutDragged.findIndex((t) => t.id === targetCardId);
          withoutDragged.splice(targetIndex, 0, updatedTodo);
          updateAll(withoutDragged);
          return;
        }
      }

      // No valid target card — append (end of column)
      updateAll([...withoutDragged, updatedTodo]);
    },
    [myTodos],
  );

  const handleDragOver = useCallback((e: React.DragEvent, status: TodoStatus) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverCol(status);
  }, []);

  const handleCardDragOver = useCallback((cardId: string) => {
    dragOverCardIdRef.current = cardId;
    setDragOverCardId(cardId);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverCol(null);
    setDragOverCardId(null);
    dragOverCardIdRef.current = null;
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
      {/* Main: Kanban board */}
      <div className="space-y-4">
        {/* Add todo input */}
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTodo()}
            placeholder="Add a todo..."
            className="flex-1 px-4 py-2.5 rounded-lg border border-stone-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
          <select
            value={selectedFeatureId ?? ""}
            onChange={(e) => setSelectedFeatureId(e.target.value || null)}
            className="px-3 py-2.5 rounded-lg border border-stone-200 bg-white text-xs text-stone-600 focus:outline-none focus:border-brand cursor-pointer"
          >
            <option value="">No feature</option>
            {myFeatures.map((f) => (
              <option key={f.id} value={String(f.id)}>{f.title}</option>
            ))}
          </select>
          <SearchableSelect
            value={selectedRepo ?? ""}
            onChange={(v) => setSelectedRepo(v || null)}
            options={[
              { value: "", label: "No repo" },
              ...(repos ?? []).map((r) => ({ value: r.name, label: r.name })),
            ]}
            placeholder="No repo"
            className="py-2.5"
          />
          <button
            onClick={addTodo}
            disabled={!input.trim()}
            className="px-4 py-2.5 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand/90 disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
          >
            <Plus size={16} />
            Add
          </button>
        </div>

        {/* Kanban columns */}
        <div className="grid grid-cols-3 gap-4">
          {COLUMNS.map(({ status, label }) => (
            <div
              key={status}
              onDragOver={(e) => handleDragOver(e, status)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, status)}
              className={cn(
                "rounded-xl border border-stone-200 bg-stone-50 transition-colors min-h-[200px] flex flex-col",
                dragOverCol === status && "border-brand/50 bg-brand/5",
              )}
            >
              {/* Column header */}
              <div className="px-4 py-3 border-b border-stone-100 bg-white rounded-t-xl flex items-center justify-between">
                <span className="text-sm font-medium text-stone-700">
                  {label}{" "}
                  <span className="text-stone-400 font-normal">
                    ({columns[status].length})
                  </span>
                </span>
                {status === "done" && columns.done.length > 0 && (
                  <button
                    onClick={clearDone}
                    className="flex items-center gap-1 text-xs text-stone-400 hover:text-red-500 cursor-pointer transition-colors"
                  >
                    <Trash2 size={13} />
                    Clear
                  </button>
                )}
              </div>

              {/* Cards */}
              <div className="p-2 space-y-2 flex-1 overflow-y-auto">
                {columns[status].map((todo) => (
                  <TodoCard
                    key={todo.id}
                    todo={todo}
                    feature={todo.featureId ? featureMap.get(todo.featureId) : undefined}
                    org={selectedOrg}
                    onDelete={() => deleteTodo(todo.id)}
                    onClick={() => setDetailTodo(todo)}
                    onDragStart={handleDragStart}
                    onCardDragOver={handleCardDragOver}
                    isDropTarget={dragOverCardId === todo.id}
                  />
                ))}
                {columns[status].length === 0 && (
                  <div className="text-center py-8 text-stone-300 text-xs">
                    {status === "backlog" && "New todos land here"}
                    {status === "in_progress" && "Drag items here"}
                    {status === "done" && "Completed items"}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sidebar: My Features */}
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden h-fit">
        <div className="px-4 py-3 border-b border-stone-100">
          <span className="text-sm font-medium text-stone-700">
            My Features{" "}
            <span className="text-stone-400 font-normal">({myFeatures.length})</span>
          </span>
        </div>
        <div className="p-2 space-y-0.5 overflow-y-auto max-h-[500px]">
          {myFeatures.map((f) => (
            <button
              key={f.id}
              onClick={() => addFeatureTodo(f)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md hover:bg-stone-50 cursor-pointer text-left"
            >
              <span className={cn("w-2 h-2 rounded-full shrink-0", STATUS_DOT[f.status])} />
              <span className="text-sm text-stone-700 truncate flex-1">{f.title}</span>
              <Plus size={14} className="text-stone-300 shrink-0" />
            </button>
          ))}
          {myFeatures.length === 0 && (
            <div className="px-3 py-4 text-sm text-stone-400 text-center">
              No features assigned
            </div>
          )}
        </div>
      </div>

      {/* Detail modal */}
      {detailTodo && (
        <TodoDetailModal
          todo={detailTodo}
          feature={detailTodo.featureId ? featureMap.get(detailTodo.featureId) : undefined}
          allFeatures={myFeatures}
          repos={repos ?? []}
          org={selectedOrg}
          onUpdate={(patch) => {
            updateTodo(detailTodo.id, patch);
            setDetailTodo((prev) => prev ? { ...prev, ...patch } : prev);
          }}
          onClose={() => setDetailTodo(null)}
        />
      )}
    </div>
  );
}

// --------------- TodoCard ---------------

function TodoCard({
  todo,
  feature,
  org,
  onDelete,
  onClick,
  onDragStart,
  onCardDragOver,
  isDropTarget,
}: {
  todo: Todo;
  feature?: Feature;
  org: string | null;
  onDelete: () => void;
  onClick: () => void;
  onDragStart: (e: React.DragEvent, todo: Todo) => void;
  onCardDragOver: (cardId: string) => void;
  isDropTarget: boolean;
}) {
  const isDone = todo.status === "done";

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, todo)}
      onDragOver={(e) => {
        e.preventDefault();
        onCardDragOver(todo.id);
      }}
      onClick={onClick}
      className={cn(
        "flex items-start gap-3 px-3 py-2.5 rounded-lg border bg-white cursor-grab active:cursor-grabbing",
        isDone ? "border-stone-100 opacity-50" : "border-stone-200 hover:border-stone-300",
        isDropTarget && "border-t-2 border-t-brand",
      )}
    >
      <div className="flex-1 min-w-0">
        <span
          className={cn(
            "text-sm block",
            isDone && "line-through text-stone-400",
          )}
        >
          {todo.title}
        </span>
        {(feature || todo.repo) && (
          <span className="flex items-center gap-2 mt-0.5 flex-wrap">
            {feature && (
              <span className="flex items-center gap-1.5">
                <span className={cn("w-1.5 h-1.5 rounded-full", STATUS_DOT[feature.status])} />
                <span className="text-xs text-stone-400">{feature.title}</span>
              </span>
            )}
            {todo.repo && (
              <a
                href={org ? `https://github.com/${org}/${todo.repo}` : "#"}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-1 text-xs text-stone-400 hover:text-brand transition-colors"
              >
                <GitBranch size={10} />
                {todo.repo}
              </a>
            )}
          </span>
        )}
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="text-stone-300 hover:text-red-500 cursor-pointer transition-colors mt-0.5"
      >
        <X size={14} />
      </button>
    </div>
  );
}

// --------------- TodoDetailModal ---------------

function TodoDetailModal({
  todo,
  feature,
  allFeatures,
  repos,
  org,
  onUpdate,
  onClose,
}: {
  todo: Todo;
  feature?: Feature;
  allFeatures: Feature[];
  repos: RepoInfo[];
  org: string | null;
  onUpdate: (patch: Partial<Todo>) => void;
  onClose: () => void;
}) {
  const [plan, setPlan] = useState<string | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!org) { setPlan(null); setPlanLoading(false); return; }
    setPlanLoading(true);
    fetchTodoPlanFile(org, todo.id)
      .then((result) => { if (!cancelled) setPlan(result?.content ?? null); })
      .catch((err) => { if (!cancelled) { setPlan(null); broadcastError(err instanceof Error ? err.message : "Failed to load plan"); } })
      .finally(() => { if (!cancelled) setPlanLoading(false); });
    return () => { cancelled = true; };
  }, [org, todo.id]);

  const planUrl = org
    ? `https://github.com/${org}/.gitpulse/blob/main/${todoPlanFilePath(todo.id)}`
    : null;

  const repoUrl = org && todo.repo
    ? `https://github.com/${org}/${todo.repo}`
    : null;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="todo-detail-title"
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
          <input
            id="todo-detail-title"
            value={todo.title}
            onChange={(e) => onUpdate({ title: e.target.value })}
            className="text-lg font-semibold text-stone-800 bg-transparent border-none outline-none focus:ring-0 w-full truncate"
          />
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* Meta row: feature + repo selectors */}
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <span className="text-xs text-stone-500 block mb-1">Feature</span>
              <select
                value={todo.featureId ?? ""}
                onChange={(e) => onUpdate({ featureId: e.target.value || undefined })}
                className="px-2.5 py-1.5 rounded-md border border-stone-200 bg-white text-xs text-stone-700 focus:outline-none focus:border-brand cursor-pointer"
              >
                <option value="">None</option>
                {allFeatures.map((f) => (
                  <option key={f.id} value={String(f.id)}>{f.title}</option>
                ))}
              </select>
            </div>
            <div>
              <span className="text-xs text-stone-500 block mb-1">Repo</span>
              <div className="flex items-center gap-1.5">
                <SearchableSelect
                  value={todo.repo ?? ""}
                  onChange={(v) => onUpdate({ repo: v || undefined })}
                  options={[
                    { value: "", label: "None" },
                    ...repos.map((r) => ({ value: r.name, label: r.name })),
                  ]}
                  placeholder="None"
                />
                {repoUrl && (
                  <a
                    href={repoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-stone-400 hover:text-brand transition-colors"
                    title="Open on GitHub"
                  >
                    <ExternalLink size={13} />
                  </a>
                )}
              </div>
            </div>
            <div>
              <span className="text-xs text-stone-500 block mb-1">Status</span>
              <select
                value={todo.status}
                onChange={(e) => onUpdate({ status: e.target.value as TodoStatus })}
                className="px-2.5 py-1.5 rounded-md border border-stone-200 bg-white text-xs text-stone-700 focus:outline-none focus:border-brand cursor-pointer"
              >
                {COLUMNS.map((c) => (
                  <option key={c.status} value={c.status}>{c.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Linked feature info */}
          {feature && (
            <div className="flex items-center gap-2 text-xs text-stone-500">
              <span className={cn("w-2 h-2 rounded-full", STATUS_DOT[feature.status])} />
              Feature: {feature.title}
            </div>
          )}

          {/* Implementation Plan */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-stone-500">Implementation Plan</span>
              <div className="flex items-center gap-2">
                {planUrl && plan !== null && (
                  <a
                    href={planUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-stone-400 hover:text-brand flex items-center gap-1"
                    title="View on GitHub"
                  >
                    <ExternalLink size={12} />
                  </a>
                )}
                {!planLoading && !editMode && plan !== null && (
                  <button
                    onClick={() => { setEditContent(plan); setEditMode(true); setSaveError(null); }}
                    className="text-xs text-stone-400 hover:text-brand flex items-center gap-1 cursor-pointer"
                  >
                    <Pencil size={12} />
                    Edit
                  </button>
                )}
              </div>
            </div>

            {planLoading && (
              <div className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-8 flex justify-center">
                <Spinner />
              </div>
            )}

            {!planLoading && !editMode && plan === null && (
              <div className="rounded-lg border border-dashed border-stone-200 bg-stone-50 px-4 py-8 text-center text-sm text-stone-400">
                <FileText size={20} className="mx-auto mb-2 text-stone-300" />
                No plan found.
                <br />
                <button
                  onClick={() => { setEditContent(""); setEditMode(true); setSaveError(null); }}
                  className="mt-2 px-3 py-1.5 rounded-md bg-brand text-white text-xs font-medium hover:bg-brand/90 cursor-pointer"
                >
                  Create Plan
                </button>
              </div>
            )}

            {!planLoading && !editMode && plan !== null && (
              <pre className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700 font-mono whitespace-pre-wrap overflow-y-auto max-h-[50vh]">
                {plan}
              </pre>
            )}

            {editMode && (
              <div className="space-y-2">
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm text-stone-700 font-mono whitespace-pre-wrap focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand resize-y min-h-[200px] max-h-[50vh]"
                  rows={12}
                />
                {saveError && (
                  <p className="text-xs text-red-500">{saveError}</p>
                )}
                <div className="flex items-center gap-2">
                  <button
                    onClick={async () => {
                      if (!org) return;
                      setSaving(true);
                      setSaveError(null);
                      try {
                        await saveTodoPlanFile(org, todo.id, editContent);
                        setPlan(editContent);
                        setEditMode(false);
                      } catch (err) {
                        setSaveError(err instanceof Error ? err.message : "Failed to save plan");
                      } finally {
                        setSaving(false);
                      }
                    }}
                    disabled={saving}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-brand text-white text-xs font-medium hover:bg-brand/90 disabled:opacity-50 cursor-pointer"
                  >
                    {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                    {saving ? "Saving..." : "Save & Sync"}
                  </button>
                  <button
                    onClick={() => { setEditMode(false); setSaveError(null); }}
                    disabled={saving}
                    className="px-3 py-1.5 rounded-md border border-stone-200 text-xs text-stone-600 hover:bg-stone-50 disabled:opacity-50 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
