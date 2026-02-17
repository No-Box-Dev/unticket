import { useState, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useTodos, useSaveTodos } from "@/hooks/useConfigRepo";
import { Plus, X, Check } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Todo } from "@/lib/types";

export function TodoTab() {
  const { user } = useAuth();
  const { data: allTodos, isLoading } = useTodos();
  const saveTodos = useSaveTodos();
  const [input, setInput] = useState("");

  const myTodos = useMemo(() => {
    if (!allTodos || !user) return [];
    return allTodos.filter((t) => t.owner === user.login);
  }, [allTodos, user]);

  const pending = useMemo(() => myTodos.filter((t) => !t.done), [myTodos]);
  const done = useMemo(() => myTodos.filter((t) => t.done), [myTodos]);

  function updateAll(next: Todo[]) {
    if (!allTodos) return;
    // Replace current user's todos in the full list
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
    };
    updateAll([...myTodos, todo]);
    setInput("");
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
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addTodo()}
          placeholder="Add a todo..."
          className="flex-1 px-4 py-2.5 rounded-lg border border-stone-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
        />
        <button
          onClick={addTodo}
          disabled={!input.trim()}
          className="px-4 py-2.5 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand/90 disabled:opacity-40 cursor-pointer flex items-center gap-1.5"
        >
          <Plus size={16} />
          Add
        </button>
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
              onToggle={() => toggleDone(todo.id)}
              onDelete={() => deleteTodo(todo.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TodoCard({
  todo,
  onToggle,
  onDelete,
}: {
  todo: Todo;
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
      <span
        className={cn(
          "flex-1 text-sm",
          todo.done && "line-through text-stone-400",
        )}
      >
        {todo.title}
      </span>
      <button
        onClick={onDelete}
        className="text-stone-300 hover:text-red-500 cursor-pointer transition-colors"
      >
        <X size={16} />
      </button>
    </div>
  );
}
