import { useState } from "react";
import { Plus } from "lucide-react";

interface AddFeatureInputProps {
  onAdd: (title: string) => void;
}

export function AddFeatureInput({ onAdd }: AddFeatureInputProps) {
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(false);

  const submit = () => {
    const trimmed = value.trim();
    if (trimmed) {
      onAdd(trimmed);
      setValue("");
      setEditing(false);
    }
  };

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-brand cursor-pointer py-1"
      >
        <Plus className="w-3.5 h-3.5" />
        Add Feature
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 py-1">
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") {
            setEditing(false);
            setValue("");
          }
        }}
        onBlur={() => {
          if (!value.trim()) setEditing(false);
        }}
        placeholder="Feature title..."
        className="flex-1 text-sm border border-stone-200 rounded-lg px-2.5 py-1 focus:outline-none focus:border-brand"
      />
      <button
        onClick={submit}
        className="text-xs font-medium text-brand hover:text-brand/80 cursor-pointer"
      >
        Add
      </button>
    </div>
  );
}
