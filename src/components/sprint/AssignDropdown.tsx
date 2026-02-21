import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";

interface AssignDropdownProps {
  owners: string[];
  allPeople: string[];
  onChange: (owners: string[]) => void;
}

export function AssignDropdown({ owners, allPeople, onChange }: AssignDropdownProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pos, setPos] = useState({ top: 0, left: 0, flip: false });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const updatePos = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    // Flip upward if less than 200px below trigger
    if (spaceBelow < 200) {
      setPos({ top: rect.top - 4, left: rect.left, flip: true });
    } else {
      setPos({ top: rect.bottom + 4, left: rect.left, flip: false });
    }
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        dropdownRef.current?.contains(target)
      ) return;
      setOpen(false);
      setSearch("");
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (open) {
      updatePos();
      inputRef.current?.focus();
    }
  }, [open, updatePos]);

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
    <>
      <button
        ref={triggerRef}
        onClick={() => setOpen(!open)}
        className="text-xs cursor-pointer"
      >
        {owners.length === 0 ? (
          <span className="text-stone-300 hover:text-stone-400">+ Assign</span>
        ) : (
          <span className="text-stone-400 hover:text-stone-600">{owners.join(", ")}</span>
        )}
      </button>
      {open && createPortal(
        <div
          ref={dropdownRef}
          style={{
            position: "fixed",
            left: pos.left,
            ...(pos.flip
              ? { bottom: window.innerHeight - pos.top }
              : { top: pos.top }),
          }}
          className="z-50 bg-white border border-stone-200 rounded-lg shadow-lg py-1 min-w-[160px]"
        >
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
        </div>,
        document.body,
      )}
    </>
  );
}
