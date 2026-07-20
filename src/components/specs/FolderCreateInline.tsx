import { useState } from "react";
import { Plus } from "lucide-react";
import { useCreateSpecFolder } from "@/hooks/useSpecs";

// Inline "+ New project" affordance for the sidebar. Starts as a small button;
// click swaps in an autoFocus input, Enter creates, Esc cancels. Same shape
// as AddFeatureInput on the Sprint tab so users get a consistent add-in-place
// pattern across the app.
export function FolderCreateInline() {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const createMut = useCreateSpecFolder();

  function submit() {
    const trimmed = value.trim();
    if (!trimmed) {
      setEditing(false);
      setValue("");
      return;
    }
    createMut.mutate(
      { name: trimmed },
      {
        onSettled: () => {
          setValue("");
          setEditing(false);
        },
      },
    );
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-stone-400 hover:text-accent hover:bg-stone-100 cursor-pointer"
      >
        <Plus size={12} /> New project
      </button>
    );
  }

  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={submit}
      onKeyDown={(e) => {
        if (e.key === "Enter") submit();
        if (e.key === "Escape") {
          setValue("");
          setEditing(false);
        }
      }}
      placeholder="Project name"
      className="w-full px-2 py-1.5 rounded-md border border-accent bg-white text-xs text-stone-700 focus:outline-none"
    />
  );
}
