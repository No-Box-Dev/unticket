import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { useTodos, useCreateTodoItem, useUpdateTodoItem, useDeleteTodoItem, useFeatures, useAllSprintSubIssues, useSprint, useUpdateFeature, useDeleteFeature, usePeople, useUpdateTaskPoints } from "@/hooks/useConfigRepo";
import { useIsAdmin } from "@/hooks/useGitHub";
import { fetchTodoPlanFile, todoPlanFilePath, saveTodoPlanFile } from "@/lib/config-repo";
import { broadcastError } from "@/lib/api";
import { withStatusTransition } from "@/lib/github-features";
import { Plus, X, Trash2, ExternalLink, FileText, Pencil, Save, Loader2, Zap, ListChecks, LayoutGrid, Users } from "lucide-react";
import { Spinner } from "@/components/Spinner";
import { FeatureCard } from "@/components/sprint/FeatureCard";
import { FeatureDetailModal } from "@/components/sprint/FeatureDetailModal";
import { PointsSelect } from "@/components/sprint/PointsSelect";
import { cn } from "@/lib/cn";
import type { Todo, TodoStatus, Feature, FeatureStatus, Points } from "@/lib/types";
import type { SubIssueWithFeature } from "@/hooks/useConfigRepo";

type TodoView = "todos" | "features" | "roles";
type SprintFilter = "sprint" | "all";

const VIEW_TABS: { key: TodoView; label: string; icon: typeof ListChecks }[] = [
  { key: "todos", label: "My Todos", icon: ListChecks },
  { key: "features", label: "My Features", icon: LayoutGrid },
  { key: "roles", label: "My Roles", icon: Users },
];

const STATUS_DOT: Record<FeatureStatus, string> = {
  plan: "bg-brand",
  in_progress: "bg-amber-500",
  demo: "bg-purple-500",
  tested: "bg-cyan-500",
  production: "bg-green-500",
  future: "bg-stone-300",
};

const TODO_COLUMNS: { status: TodoStatus; label: string; color: string }[] = [
  { status: "backlog", label: "Backlog", color: "bg-stone-400" },
  { status: "in_progress", label: "In Progress", color: "bg-amber-500" },
  { status: "done", label: "Done", color: "bg-green-500" },
];

type BoardStatus = Exclude<FeatureStatus, "future">;
const FEATURE_COLUMNS: { status: BoardStatus; label: string; color: string }[] = [
  { status: "plan", label: "Plan", color: "bg-brand" },
  { status: "in_progress", label: "In Progress", color: "bg-amber-500" },
  { status: "demo", label: "Demo", color: "bg-purple-500" },
  { status: "tested", label: "Tested", color: "bg-cyan-500" },
  { status: "production", label: "In Production", color: "bg-green-500" },
];

export function TodoTab() {
  const { user, selectedOrg } = useAuth();
  const { data: myTodos, isLoading } = useTodos();
  const { data: features } = useFeatures();
  const { data: sprint } = useSprint();
  const { data: people } = usePeople();
  const isAdmin = useIsAdmin();
  const createTodoMut = useCreateTodoItem();
  const updateTodoMut = useUpdateTodoItem();
  const deleteTodoMut = useDeleteTodoItem();
  const updateFeatureMut = useUpdateFeature();
  const deleteFeatureMut = useDeleteFeature();
  const updateTaskPointsMut = useUpdateTaskPoints();

  const [todoView, setTodoView] = useState<TodoView>("todos");
  const [sprintFilter, setSprintFilter] = useState<SprintFilter>("sprint");
  const [detailTodo, setDetailTodo] = useState<Todo | null>(null);
  const [detailFeature, setDetailFeature] = useState<Feature | null>(null);

  // Sprint tasks assigned to me
  const sprintFeatureIds = useMemo(
    () => (features ?? []).filter((f) => f.status !== "future" && f.sprint !== null).map((f) => f.id),
    [features],
  );
  const { data: allSprintTasks, isLoading: tasksLoading } = useAllSprintSubIssues(sprintFeatureIds);
  const mySprintTasks = useMemo(() => {
    if (!allSprintTasks || !user) return [];
    return allSprintTasks.filter((t) => t.assignees.includes(user.login));
  }, [allSprintTasks, user]);

  const todos = useMemo(() => myTodos ?? [], [myTodos]);

  const currentSprintNumber = sprint?.number ?? null;

  const myFeatures = useMemo(() => {
    if (!features || !user) return [];
    return features.filter((f) => f.owners.includes(user.login) && f.status !== "future");
  }, [features, user]);

  const featureMap = useMemo(() => {
    const map = new Map<number, Feature>();
    for (const f of features ?? []) map.set(f.id, f);
    return map;
  }, [features]);

  const allPeople = useMemo(
    () => (people ?? []).map((p) => p.github),
    [people],
  );

  const sprintOptions = useMemo(() => [
    ...(sprint ? [{ value: sprint.number, label: `Sprint ${sprint.number}` }] : []),
    { value: null as number | null, label: "Backlog" },
  ], [sprint]);

  // Filtered todos for sprint filter
  const filteredTodos = useMemo(() => {
    if (sprintFilter === "all") return todos;
    const sprintFeatIds = new Set(
      (features ?? [])
        .filter((f) => f.sprint === currentSprintNumber && f.status !== "future")
        .map((f) => f.id),
    );
    return todos.filter((t) => !t.featureId || sprintFeatIds.has(t.featureId));
  }, [todos, sprintFilter, features, currentSprintNumber]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-8">
      {/* Header: view tabs + sprint filter */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center bg-stone-100 dark:bg-dark-overlay rounded-lg p-0.5">
          {VIEW_TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTodoView(key)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer transition-all",
                todoView === key
                  ? "bg-white dark:bg-dark-raised text-stone-800 dark:text-neutral-200 shadow-sm"
                  : "text-stone-500 dark:text-neutral-400 hover:text-stone-700 dark:hover:text-neutral-300",
              )}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>

        {todoView === "todos" && (
          <div className="flex items-center bg-stone-100 dark:bg-dark-overlay rounded-lg p-0.5">
            {(["sprint", "all"] as SprintFilter[]).map((v) => (
              <button
                key={v}
                onClick={() => setSprintFilter(v)}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer transition-all",
                  sprintFilter === v
                    ? "bg-white dark:bg-dark-raised text-stone-800 dark:text-neutral-200 shadow-sm"
                    : "text-stone-500 dark:text-neutral-400 hover:text-stone-700 dark:hover:text-neutral-300",
                )}
              >
                {v === "sprint" ? `Sprint ${currentSprintNumber ?? ""}` : "All"}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* View content */}
      {todoView === "todos" && (
        <MyTodosView
          todos={filteredTodos}
          allTodos={todos}
          myFeatures={myFeatures}
          featureMap={featureMap}
          createTodoMut={createTodoMut}
          updateTodoMut={updateTodoMut}
          deleteTodoMut={deleteTodoMut}
          selectedOrg={selectedOrg}
          onOpenDetail={setDetailTodo}
        />
      )}

      {todoView === "features" && (
        <MyFeaturesView
          myFeatures={myFeatures}
          allPeople={allPeople}
          updateFeatureMut={updateFeatureMut}
          deleteFeatureMut={deleteFeatureMut}
          onOpenDetail={setDetailFeature}
          isAdmin={isAdmin}
          currentSprint={currentSprintNumber ?? undefined}
        />
      )}

      {todoView === "roles" && (
        <MyRolesView
          mySprintTasks={mySprintTasks}
          featureMap={featureMap}
          features={features ?? []}
          tasksLoading={tasksLoading}
          onOpenDetail={(f) => setDetailFeature(f)}
          onUpdateTaskPoints={(taskNumber, pts) => updateTaskPointsMut.mutate({ taskNumber, points: pts })}
        />
      )}

      {/* Todo detail modal */}
      {detailTodo && (
        <TodoDetailModal
          todo={detailTodo}
          feature={detailTodo.featureId ? featureMap.get(detailTodo.featureId) : undefined}
          allFeatures={myFeatures}
          org={selectedOrg}
          onUpdate={(patch) => {
            updateTodoMut.mutate({
              issueNumber: detailTodo.id,
              updates: patch,
            });
            setDetailTodo((prev) => prev ? { ...prev, ...patch } as Todo : prev);
          }}
          onClose={() => setDetailTodo(null)}
        />
      )}

      {/* Feature detail modal */}
      {detailFeature && (
        <FeatureDetailModal
          feature={detailFeature}
          allPeople={allPeople}
          onClose={() => setDetailFeature(null)}
          onUpdate={(updated) => {
            updateFeatureMut.mutate(updated);
            setDetailFeature(updated);
          }}
          sprintOptions={sprintOptions}
        />
      )}
    </div>
  );
}

// ─── My Todos View ──────────────────────────────────────────────────────

function MyTodosView({
  todos,
  allTodos,
  myFeatures,
  featureMap,
  createTodoMut,
  updateTodoMut,
  deleteTodoMut,
  selectedOrg,
  onOpenDetail,
}: {
  todos: Todo[];
  allTodos: Todo[];
  myFeatures: Feature[];
  featureMap: Map<number, Feature>;
  createTodoMut: ReturnType<typeof useCreateTodoItem>;
  updateTodoMut: ReturnType<typeof useUpdateTodoItem>;
  deleteTodoMut: ReturnType<typeof useDeleteTodoItem>;
  selectedOrg: string | null;
  onOpenDetail: (t: Todo) => void;
}) {
  const { user } = useAuth();
  const [input, setInput] = useState("");
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<TodoStatus | null>(null);
  const [dragOverCardId, setDragOverCardId] = useState<string | null>(null);
  const dragOverCardIdRef = useRef<string | null>(null);

  const columns = useMemo(() => {
    const grouped: Record<TodoStatus, Todo[]> = { backlog: [], in_progress: [], done: [] };
    for (const t of todos) grouped[t.status].push(t);
    return grouped;
  }, [todos]);

  function addTodo() {
    const title = input.trim();
    if (!title || !user) return;
    const featureId = selectedFeatureId ? parseInt(selectedFeatureId) : undefined;
    createTodoMut.mutate({
      title,
      featureId: featureId && !isNaN(featureId) ? featureId : undefined,
    });
    setInput("");
    setSelectedFeatureId(null);
  }

  function handleDeleteTodo(id: number) {
    if (!window.confirm("Delete this todo?")) return;
    deleteTodoMut.mutate(id);
  }

  function clearDone() {
    const doneTodos = allTodos.filter((t) => t.status === "done");
    if (doneTodos.length === 0) return;
    if (!window.confirm(`Delete ${doneTodos.length} completed todo${doneTodos.length === 1 ? "" : "s"}?`)) return;
    for (const t of doneTodos) {
      deleteTodoMut.mutate(t.id);
    }
  }

  const handleDragStart = useCallback((e: React.DragEvent, todo: Todo) => {
    e.dataTransfer.setData("text/plain", String(todo.id));
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetStatus: TodoStatus) => {
      e.preventDefault();
      const todoId = parseInt(e.dataTransfer.getData("text/plain"));
      setDragOverCol(null);
      setDragOverCardId(null);
      dragOverCardIdRef.current = null;
      if (isNaN(todoId)) return;
      const todo = allTodos.find((t) => t.id === todoId);
      if (!todo || todo.status === targetStatus) return;
      updateTodoMut.mutate({ issueNumber: todo.id, updates: { status: targetStatus } });
    },
    [allTodos],
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

  return (
    <div className="space-y-4">
      {/* Add todo input */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addTodo()}
          placeholder="Add a todo..."
          className="flex-1 px-4 py-2.5 rounded-lg border border-stone-200 dark:border-white/[0.06] bg-white dark:bg-dark-raised text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
        />
        <select
          value={selectedFeatureId ?? ""}
          onChange={(e) => setSelectedFeatureId(e.target.value || null)}
          className="px-3 py-2.5 rounded-lg border border-stone-200 dark:border-white/[0.06] bg-white dark:bg-dark-raised text-xs text-stone-600 dark:text-neutral-400 focus:outline-none focus:border-brand cursor-pointer"
        >
          <option value="">No feature</option>
          {myFeatures.map((f) => (
            <option key={f.id} value={String(f.id)}>{f.title}</option>
          ))}
        </select>
        <button
          onClick={addTodo}
          disabled={!input.trim() || createTodoMut.isPending}
          className="px-4 py-2.5 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand/90 disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
        >
          {createTodoMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
          Add
        </button>
      </div>

      {/* Kanban columns */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {TODO_COLUMNS.map(({ status, label, color }) => {
          const items = columns[status];
          return (
            <div
              key={status}
              onDragOver={(e) => handleDragOver(e, status)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, status)}
              className={cn(
                "rounded-xl border border-stone-200 dark:border-white/[0.06] bg-stone-50 dark:bg-white/[0.04] transition-colors min-h-[200px] flex flex-col",
                dragOverCol === status && "border-brand/50 bg-brand/5",
              )}
            >
              {/* Column header */}
              <div className="px-4 py-3 border-b border-stone-100 dark:border-white/[0.06] bg-white dark:bg-dark-raised rounded-t-xl flex items-center gap-2">
                <span className={cn("w-2.5 h-2.5 rounded-full", color)} />
                <span className="text-sm font-medium text-stone-700 dark:text-neutral-300">{label}</span>
                <span className="text-xs text-stone-400 dark:text-neutral-500 ml-auto">{items.length}</span>
                {status === "done" && items.length > 0 && (
                  <button
                    onClick={clearDone}
                    className="flex items-center gap-1 text-xs text-stone-400 dark:text-neutral-500 hover:text-red-500 cursor-pointer transition-colors ml-1"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>

              {/* Cards */}
              <div className="p-2 space-y-2 flex-1 overflow-y-auto">
                {items.map((todo) => (
                  <TodoCard
                    key={todo.id}
                    todo={todo}
                    feature={todo.featureId ? featureMap.get(todo.featureId) : undefined}
                    onDelete={() => handleDeleteTodo(todo.id)}
                    onClick={() => onOpenDetail(todo)}
                    onDragStart={handleDragStart}
                    onCardDragOver={handleCardDragOver}
                    isDropTarget={dragOverCardId === String(todo.id)}
                  />
                ))}
                {items.length === 0 && (
                  <div className="text-center py-8 text-stone-300 dark:text-neutral-600 text-xs">
                    {status === "backlog" && "New todos land here"}
                    {status === "in_progress" && "Drag items here"}
                    {status === "done" && "Completed items"}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── My Features View ───────────────────────────────────────────────────

function MyFeaturesView({
  myFeatures,
  allPeople,
  updateFeatureMut,
  deleteFeatureMut,
  onOpenDetail,
  isAdmin,
  currentSprint,
}: {
  myFeatures: Feature[];
  allPeople: string[];
  updateFeatureMut: ReturnType<typeof useUpdateFeature>;
  deleteFeatureMut: ReturnType<typeof useDeleteFeature>;
  onOpenDetail: (f: Feature) => void;
  isAdmin: boolean;
  currentSprint?: number;
}) {
  const [dragOverCol, setDragOverCol] = useState<BoardStatus | null>(null);

  const featureColumns = useMemo(() => {
    const grouped: Record<BoardStatus, Feature[]> = { plan: [], in_progress: [], demo: [], tested: [], production: [] };
    for (const f of myFeatures) {
      if (f.status !== "future") grouped[f.status as BoardStatus].push(f);
    }
    return grouped;
  }, [myFeatures]);

  const handleDragStart = useCallback((e: React.DragEvent, feature: Feature) => {
    e.dataTransfer.setData("text/plain", String(feature.id));
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetStatus: BoardStatus) => {
      e.preventDefault();
      setDragOverCol(null);
      const featureId = parseInt(e.dataTransfer.getData("text/plain"));
      if (isNaN(featureId)) return;
      const feature = myFeatures.find((f) => f.id === featureId);
      if (!feature || feature.status === targetStatus) return;
      updateFeatureMut.mutate(withStatusTransition(feature, targetStatus));
    },
    [myFeatures],
  );

  const handleDragOver = useCallback((e: React.DragEvent, status: BoardStatus) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverCol(status);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverCol(null);
  }, []);

  if (myFeatures.length === 0) {
    return (
      <div className="text-center py-16 text-sm text-stone-400 dark:text-neutral-500">
        No features assigned to you
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-3">
      {FEATURE_COLUMNS.map(({ status, label, color }) => {
        const items = featureColumns[status];
        return (
          <div
            key={status}
            onDragOver={(e) => handleDragOver(e, status)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, status)}
            className={cn(
              "rounded-xl border border-stone-200 dark:border-white/[0.06] bg-stone-50 dark:bg-white/[0.04] transition-colors min-h-[200px] flex flex-col",
              dragOverCol === status && "border-brand/50 bg-brand/5",
            )}
          >
            {/* Column header */}
            <div className="px-4 py-3 border-b border-stone-100 dark:border-white/[0.06] bg-white dark:bg-dark-raised rounded-t-xl flex items-center gap-2">
              <span className={cn("w-2.5 h-2.5 rounded-full", color)} />
              <span className="text-sm font-medium text-stone-700 dark:text-neutral-300">{label}</span>
              <span className="text-xs text-stone-400 dark:text-neutral-500 ml-auto">{items.length}</span>
            </div>

            {/* Cards */}
            <div className="p-2 space-y-2 flex-1 overflow-y-auto max-h-[calc(100vh-260px)]">
              {items.map((feature) => (
                <FeatureCard
                  key={feature.id}
                  feature={feature}
                  allPeople={allPeople}
                  onUpdate={(updated) => updateFeatureMut.mutate(updated)}
                  onDelete={(id) => deleteFeatureMut.mutate(id)}
                  onOpenDetail={onOpenDetail}
                  mode="sprint"
                  currentSprint={currentSprint}
                  draggable
                  onDragStart={handleDragStart}
                  isAdmin={isAdmin}
                />
              ))}
              {items.length === 0 && (
                <div className="text-center py-8 text-stone-300 dark:text-neutral-600 text-xs">
                  Drag features here
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── My Roles View ──────────────────────────────────────────────────────

function MyRolesView({
  mySprintTasks,
  featureMap,
  features,
  tasksLoading,
  onOpenDetail,
  onUpdateTaskPoints,
}: {
  mySprintTasks: SubIssueWithFeature[];
  featureMap: Map<number, Feature>;
  features: Feature[];
  tasksLoading: boolean;
  onOpenDetail: (f: Feature) => void;
  onUpdateTaskPoints: (taskNumber: number, points: Points) => void;
}) {
  const roleGroups = useMemo(() => {
    const byRole = new Map<string, { roleName: string; featureId: number; featureTitle: string; tasks: SubIssueWithFeature[] }>();
    for (const task of mySprintTasks) {
      const roleKey = `${task.featureId}:${task.roleNumber ?? "none"}`;
      if (!byRole.has(roleKey)) {
        const feat = featureMap.get(task.featureId);
        byRole.set(roleKey, {
          roleName: task.roleName ?? "Tasks",
          featureId: task.featureId,
          featureTitle: task.featureTitle || (feat?.title ?? "Unknown"),
          tasks: [],
        });
      }
      byRole.get(roleKey)!.tasks.push(task);
    }
    return [...byRole.values()];
  }, [mySprintTasks, featureMap]);

  if (tasksLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  if (roleGroups.length === 0) {
    return (
      <div className="text-center py-16 text-sm text-stone-400 dark:text-neutral-500">
        No sprint tasks assigned to you
      </div>
    );
  }

  const allTasks = roleGroups.flatMap((r) => r.tasks);
  const doneCount = allTasks.filter((t) => t.state === "closed").length;
  const totalPts = allTasks.reduce((s, t) => s + (t.points ?? 0), 0);
  const donePts = allTasks.filter((t) => t.state === "closed").reduce((s, t) => s + (t.points ?? 0), 0);

  return (
    <div className="space-y-3">
      {/* Summary */}
      <div className="flex items-center gap-3 text-xs text-stone-500 dark:text-neutral-400">
        <span>{doneCount}/{allTasks.length} done</span>
        {totalPts > 0 && <span>{donePts}/{totalPts} pts</span>}
      </div>

      {/* Role groups */}
      <div className="bg-white dark:bg-dark-raised rounded-xl border border-stone-200 dark:border-white/[0.06] overflow-hidden">
        <div className="divide-y divide-stone-50 dark:divide-white/[0.03]">
          {roleGroups.map((role, i) => (
            <div key={i} className="px-4 py-2.5">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xs font-medium text-stone-600 dark:text-neutral-300">{role.roleName}</span>
                <button
                  onClick={() => {
                    const f = features.find((feat) => feat.id === role.featureId);
                    if (f) onOpenDetail(f);
                  }}
                  className="text-[10px] text-stone-400 dark:text-neutral-500 hover:text-brand cursor-pointer"
                >
                  {role.featureTitle}
                </button>
              </div>
              <div className="space-y-0.5 ml-1">
                {role.tasks.map((task) => {
                  const isDone = task.state === "closed";
                  return (
                    <div key={task.id} className="flex items-center gap-2 py-0.5">
                      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", isDone ? "bg-green-500" : "bg-stone-300 dark:bg-neutral-600")} />
                      <a href={task.html_url} target="_blank" rel="noopener noreferrer"
                        className={cn("text-sm hover:text-brand flex-1", isDone ? "line-through text-stone-400 dark:text-neutral-500" : "text-stone-700 dark:text-neutral-300")}>
                        {task.title}
                      </a>
                      <PointsSelect value={task.points ?? undefined} onChange={(pts) => onUpdateTaskPoints(task.number, pts)} />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── TodoCard ───────────────────────────────────────────────────────────

function TodoCard({
  todo,
  feature,
  onDelete,
  onClick,
  onDragStart,
  onCardDragOver,
  isDropTarget,
}: {
  todo: Todo;
  feature?: Feature;
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
        onCardDragOver(String(todo.id));
      }}
      onClick={onClick}
      className={cn(
        "flex items-start gap-3 px-3 py-2.5 rounded-lg border bg-white dark:bg-dark-raised cursor-grab active:cursor-grabbing",
        isDone ? "border-stone-100 dark:border-white/[0.06] opacity-50" : "border-stone-200 dark:border-white/[0.06] hover:border-stone-300 dark:hover:border-white/[0.1]",
        isDropTarget && "border-t-2 border-t-brand",
      )}
    >
      <div className="flex-1 min-w-0">
        <span
          className={cn(
            "text-sm block",
            isDone && "line-through text-stone-400 dark:text-neutral-500",
          )}
        >
          {todo.title}
        </span>
        {feature && (
          <span className="flex items-center gap-1.5 mt-0.5">
            <span className={cn("w-1.5 h-1.5 rounded-full", STATUS_DOT[feature.status])} />
            <span className="text-xs text-stone-400 dark:text-neutral-500">{feature.title}</span>
          </span>
        )}
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="text-stone-300 dark:text-neutral-600 hover:text-red-500 cursor-pointer transition-colors mt-0.5"
      >
        <X size={14} />
      </button>
    </div>
  );
}

// ─── TodoDetailModal ────────────────────────────────────────────────────

function TodoDetailModal({
  todo,
  feature,
  allFeatures,
  org,
  onUpdate,
  onClose,
}: {
  todo: Todo;
  feature?: Feature;
  allFeatures: Feature[];
  org: string | null;
  onUpdate: (patch: { title?: string; status?: TodoStatus; featureId?: number | null }) => void;
  onClose: () => void;
}) {
  const [plan, setPlan] = useState<string | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const planId = String(todo.id);

  useEffect(() => {
    let cancelled = false;
    if (!org) { setPlan(null); setPlanLoading(false); return; }
    setPlanLoading(true);
    fetchTodoPlanFile(org, planId)
      .then((result) => { if (!cancelled) setPlan(result?.content ?? null); })
      .catch((err) => { if (!cancelled) { setPlan(null); broadcastError(err instanceof Error ? err.message : "Failed to load plan"); } })
      .finally(() => { if (!cancelled) setPlanLoading(false); });
    return () => { cancelled = true; };
  }, [org, planId]);

  const planUrl = org
    ? `https://github.com/${org}/gitpulse/blob/main/${todoPlanFilePath(planId)}`
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
        className="bg-white dark:bg-dark-raised rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100 dark:border-white/[0.06]">
          <input
            id="todo-detail-title"
            value={todo.title}
            onChange={(e) => onUpdate({ title: e.target.value })}
            className="text-lg font-semibold text-stone-800 dark:text-neutral-200 bg-transparent border-none outline-none focus:ring-0 w-full"
          />
          <div className="flex items-center gap-2 shrink-0">
            {todo.html_url && (
              <a
                href={todo.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-stone-400 dark:text-neutral-500 hover:text-brand transition-colors"
                title="View on GitHub"
              >
                <ExternalLink size={16} />
              </a>
            )}
            <button onClick={onClose} className="text-stone-400 dark:text-neutral-500 hover:text-stone-600 dark:hover:text-neutral-400 cursor-pointer">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* Meta row */}
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <span className="text-xs text-stone-500 dark:text-neutral-400 block mb-1">Feature</span>
              <select
                value={todo.featureId ? String(todo.featureId) : ""}
                onChange={(e) => onUpdate({ featureId: e.target.value ? parseInt(e.target.value) : null })}
                className="px-2.5 py-1.5 rounded-md border border-stone-200 dark:border-white/[0.06] bg-white dark:bg-dark-raised text-xs text-stone-700 dark:text-neutral-300 focus:outline-none focus:border-brand cursor-pointer"
              >
                <option value="">None</option>
                {allFeatures.map((f) => (
                  <option key={f.id} value={String(f.id)}>{f.title}</option>
                ))}
              </select>
            </div>
            <div>
              <span className="text-xs text-stone-500 dark:text-neutral-400 block mb-1">Status</span>
              <select
                value={todo.status}
                onChange={(e) => onUpdate({ status: e.target.value as TodoStatus })}
                className="px-2.5 py-1.5 rounded-md border border-stone-200 dark:border-white/[0.06] bg-white dark:bg-dark-raised text-xs text-stone-700 dark:text-neutral-300 focus:outline-none focus:border-brand cursor-pointer"
              >
                {TODO_COLUMNS.map((c) => (
                  <option key={c.status} value={c.status}>{c.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Linked feature info */}
          {feature && (
            <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-neutral-400">
              <span className={cn("w-2 h-2 rounded-full", STATUS_DOT[feature.status])} />
              Feature: {feature.title}
            </div>
          )}

          {/* Implementation Plan */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-stone-500 dark:text-neutral-400">Implementation Plan</span>
              <div className="flex items-center gap-2">
                {planUrl && plan !== null && (
                  <a
                    href={planUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-stone-400 dark:text-neutral-500 hover:text-brand flex items-center gap-1"
                    title="View on GitHub"
                  >
                    <ExternalLink size={12} />
                  </a>
                )}
                {!planLoading && !editMode && plan !== null && (
                  <button
                    onClick={() => { setEditContent(plan); setEditMode(true); setSaveError(null); }}
                    className="text-xs text-stone-400 dark:text-neutral-500 hover:text-brand flex items-center gap-1 cursor-pointer"
                  >
                    <Pencil size={12} />
                    Edit
                  </button>
                )}
              </div>
            </div>

            {planLoading && (
              <div className="rounded-lg border border-stone-200 dark:border-white/[0.06] bg-stone-50 dark:bg-white/[0.04] px-4 py-8 flex justify-center">
                <Spinner />
              </div>
            )}

            {!planLoading && !editMode && plan === null && (
              <div className="rounded-lg border border-dashed border-stone-200 dark:border-white/[0.06] bg-stone-50 dark:bg-white/[0.04] px-4 py-8 text-center text-sm text-stone-400 dark:text-neutral-500">
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
              <pre className="rounded-lg border border-stone-200 dark:border-white/[0.06] bg-stone-50 dark:bg-white/[0.04] px-4 py-3 text-sm text-stone-700 dark:text-neutral-300 font-mono whitespace-pre-wrap overflow-y-auto max-h-[50vh]">
                {plan}
              </pre>
            )}

            {editMode && (
              <div className="space-y-2">
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full rounded-lg border border-stone-300 dark:border-white/[0.1] bg-white dark:bg-dark-raised px-4 py-3 text-sm text-stone-700 dark:text-neutral-300 font-mono whitespace-pre-wrap focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand resize-y min-h-[200px] max-h-[50vh]"
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
                        await saveTodoPlanFile(org, planId, editContent);
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
                    className="px-3 py-1.5 rounded-md border border-stone-200 dark:border-white/[0.06] text-xs text-stone-600 dark:text-neutral-400 hover:bg-stone-50 dark:hover:bg-white/[0.06] disabled:opacity-50 cursor-pointer"
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
