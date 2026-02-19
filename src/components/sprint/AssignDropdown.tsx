import { useState, useRef, useEffect } from "react";

interface AssignDropdownProps {
  owners: string[];
  allPeople: string[];
  onChange: (owners: string[]) => void;
}

export function AssignDropdown({ owners, allPeople, onChange }: AssignDropdownProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const filtered = allPeople.filter((p) =>
    p.toLowerCase().includes(search.toLowerCase()),
  );

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
        className="text-xs cursor-pointer"
      >
        {owners.length === 0 ? (
          <span className="text-stone-300 hover:text-stone-400">+ Assign</span>
        ) : (
          <span className="text-stone-400 hover:text-stone-600">{owners.join(", ")}</span>
        )}
      </button>
      {open && (
        <div className="absolute z-20 top-full left-0 mt-1 bg-white border border-stone-200 rounded-lg shadow-lg py-1 min-w-[160px]">
          <div className="px-2 pb-1">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full px-2 py-1 text-xs border border-stone-200 rounded focus:outline-none focus:border-brand"
            />
          </div>
          {filtered.map((person) => (
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
          {filtered.length === 0 && (
            <div className="px-3 py-1.5 text-xs text-stone-400">
              {allPeople.length === 0 ? "No people configured" : "No matches"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
