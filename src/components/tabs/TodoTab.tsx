import { useState, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useTodos, useSaveTodos, useFeatures } from "@/hooks/useConfigRepo";
import { Plus, X, Check } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Todo, Feature, FeatureStatus } from "@/lib/types";

const STATUS_LABEL: Record<FeatureStatus, string> = {
  plan: "Plan",
  demo: "Demo",
  production: "Production",
  future: "Backlog",
};

const STATUS_DOT: Record<FeatureStatus, string> = {
  plan: "bg-brand",
  demo: "bg-amber-500",
  production: "bg-green-500",
  future: "bg-stone-300",
};

export function TodoTab() {
  const { user } = useAuth();
  const { data: allTodos, isLoading } = useTodos();
  const { data: features } = useFeatures();
  const saveTodos = useSaveTodos();
  const [input, setInput] = useState("");
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);

  const myTodos = useMemo(() => {
    if (!allTodos || !user) return [];
    return allTodos.filter((t) => t.owner === user.login);
  }, [allTodos, user]);

  const pending = useMemo(() => myTodos.filter((t) => !t.done), [myTodos]);
  const done = useMemo(() => myTodos.filter((t) => t.done), [myTodos]);

  const myFeatures = useMemo(() => {
    if (!features || !user) return [];
    return features.filter((f) => f.owners.includes(user.login) && f.status !== "future");
  }, [features, user]);

  const featureMap = useMemo(() => {
    const map = new Map<string, Feature>();
    for (const f of features ?? []) map.set(f.id, f);
    return map;
  }, [features]);

  function updateAll(next: Todo[]) {
    if (!allTodos) return;
    const others = allTodos.filter((t) => t.owner !== user!.login);
    saveTodos.mutate([...others, ...next]);
  }

  function addTodo() {
    const title = input.trim();
    if (!title || !user) return;
    const todo: Todo = {
      id: crypto.randomUUID(),
      title,
      owner: user.login,
      done: false,
      createdAt: new Date().toISOString(),
      ...(selectedFeatureId ? { featureId: selectedFeatureId } : {}),
    };
    updateAll([...myTodos, todo]);
    setInput("");
    setSelectedFeatureId(null);
  }

  function addFeatureTodo(feature: Feature) {
    if (!user) return;
    const todo: Todo = {
      id: crypto.randomUUID(),
      title: feature.title,
      owner: user.login,
      done: false,
      createdAt: new Date().toISOString(),
      featureId: feature.id,
    };
    updateAll([...myTodos, todo]);
  }

  function toggleDone(id: string) {
    updateAll(myTodos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  }

  function deleteTodo(id: string) {
    updateAll(myTodos.filter((t) => t.id !== id));
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-stone-400">
        Loading...
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
      {/* Main: Todos */}
      <div className="space-y-6">
        {/* Add todo input */}
        <div className="space-y-2">
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
                <option key={f.id} value={f.id}>{f.title}</option>
              ))}
            </select>
            <button
              onClick={addTodo}
              disabled={!input.trim()}
              className="px-4 py-2.5 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand/90 disabled:opacity-40 cursor-pointer flex items-center gap-1.5"
            >
              <Plus size={16} />
              Add
            </button>
          </div>
        </div>

        {pending.length === 0 && done.length === 0 && (
          <div className="text-center py-16 text-stone-400 text-sm">
            No todos yet. Add one above!
          </div>
        )}

        {pending.length > 0 && (
          <div className="space-y-2">
            {pending.map((todo) => (
              <TodoCard
                key={todo.id}
                todo={todo}
                feature={todo.featureId ? featureMap.get(todo.featureId) : undefined}
                onToggle={() => toggleDone(todo.id)}
                onDelete={() => deleteTodo(todo.id)}
              />
            ))}
          </div>
        )}

        {done.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-stone-400 uppercase tracking-wide pt-4">
              Done
            </h3>
            {done.map((todo) => (
              <TodoCard
                key={todo.id}
                todo={todo}
                feature={todo.featureId ? featureMap.get(todo.featureId) : undefined}
                onToggle={() => toggleDone(todo.id)}
                onDelete={() => deleteTodo(todo.id)}
              />
            ))}
          </div>
        )}
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
    </div>
  );
}

function TodoCard({
  todo,
  feature,
  onToggle,
  onDelete,
}: {
  todo: Todo;
  feature?: Feature;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-3 rounded-lg border bg-white",
        todo.done
          ? "border-stone-100 opacity-50"
          : "border-stone-200",
      )}
    >
      <button
        onClick={onToggle}
        className={cn(
          "w-5 h-5 rounded border flex items-center justify-center shrink-0 cursor-pointer transition-colors",
          todo.done
            ? "bg-brand border-brand text-white"
            : "border-stone-300 hover:border-brand",
        )}
      >
        {todo.done && <Check size={12} />}
      </button>
      <div className="flex-1 min-w-0">
        <span
          className={cn(
            "text-sm block",
            todo.done && "line-through text-stone-400",
          )}
        >
          {todo.title}
        </span>
        {feature && (
          <span className="flex items-center gap-1.5 mt-0.5">
            <span className={cn("w-1.5 h-1.5 rounded-full", STATUS_DOT[feature.status])} />
            <span className="text-[11px] text-stone-400">{feature.title}</span>
          </span>
        )}
      </div>
      <button
        onClick={onDelete}
        className="text-stone-300 hover:text-red-500 cursor-pointer transition-colors"
      >
        <X size={16} />
      </button>
    </div>
  );
}
