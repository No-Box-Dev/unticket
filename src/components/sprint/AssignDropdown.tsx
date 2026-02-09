import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";

interface AssignDropdownProps {
  owners: string[];
  allPeople: string[];
  onChange: (owners: string[]) => void;
}

export function AssignDropdown({ owners, allPeople, onChange }: AssignDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggle = (person: string) => {
    const next = owners.includes(person)
      ? owners.filter((o) => o !== person)
      : [...owners, person];
    onChange(next);
  };

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-xs text-stone-500 hover:text-stone-700 cursor-pointer"
      >
        {owners.length === 0 ? (
          <span className="text-stone-300">Assign</span>
        ) : (
          <span className="truncate max-w-[100px]">{owners.join(", ")}</span>
        )}
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <div className="absolute z-20 top-full left-0 mt-1 bg-white border border-stone-200 rounded-lg shadow-lg py-1 min-w-[160px]">
          {allPeople.map((person) => (
            <label
              key={person}
              className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-stone-50 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={owners.includes(person)}
                onChange={() => toggle(person)}
                className="rounded border-stone-300"
              />
              {person}
            </label>
          ))}
          {allPeople.length === 0 && (
            <div className="px-3 py-1.5 text-xs text-stone-400">
              No people configured
            </div>
          )}
        </div>
      )}
    </div>
  );
}
