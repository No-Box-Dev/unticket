import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

interface Option {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  className?: string;
}

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Select...",
  className,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, flip: false });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const updatePos = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < 200) {
      setPos({ top: rect.top - 4, left: rect.left, width: Math.max(rect.width, 180), flip: true });
    } else {
      setPos({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 180), flip: false });
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
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, updatePos]);

  const filtered = options.filter((o) =>
    o.label.toLowerCase().includes(search.toLowerCase()),
  );

  const selectedLabel = options.find((o) => o.value === value)?.label;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "px-3 py-1.5 text-xs font-medium rounded-lg bg-white border border-stone-200 text-stone-600 cursor-pointer focus:outline-none focus:border-brand flex items-center gap-1.5",
          className,
        )}
      >
        <span className="truncate">{selectedLabel ?? placeholder}</span>
        <ChevronDown className="w-3 h-3 shrink-0 text-stone-400" />
      </button>
      {open && createPortal(
        <div
          ref={dropdownRef}
          style={{
            position: "fixed",
            left: pos.left,
            width: pos.width,
            ...(pos.flip
              ? { bottom: window.innerHeight - pos.top }
              : { top: pos.top }),
          }}
          className="z-50 bg-white border border-stone-200 rounded-lg shadow-lg py-1"
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
          <div className="max-h-[200px] overflow-y-auto">
            {filtered.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                  setSearch("");
                }}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-xs hover:bg-stone-50 cursor-pointer",
                  option.value === value && "bg-stone-50 font-medium text-brand",
                )}
              >
                {option.label}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-1.5 text-xs text-stone-400">No matches</div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
