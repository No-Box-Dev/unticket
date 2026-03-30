import { useState, useRef, useEffect, useCallback, useId } from "react";
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
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, flip: false });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

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

  // Click-outside close
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        dropdownRef.current?.contains(target)
      ) return;
      setOpen(false);
      setSearch("");
      setHighlightIndex(-1);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Position + focus on open
  useEffect(() => {
    if (open) {
      updatePos();
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, updatePos]);

  // Reposition on scroll/resize while open
  useEffect(() => {
    if (!open) return;
    const handleReposition = () => updatePos();
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [open, updatePos]);

  const filtered = options.filter((o) =>
    o.label.toLowerCase().includes(search.toLowerCase()),
  );

  const selectedLabel = options.find((o) => o.value === value)?.label;

  const selectOption = useCallback((opt: Option) => {
    onChange(opt.value);
    setOpen(false);
    setSearch("");
    setHighlightIndex(-1);
    triggerRef.current?.focus();
  }, [onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        setOpen(false);
        setSearch("");
        setHighlightIndex(-1);
        triggerRef.current?.focus();
        break;
      case "ArrowDown":
        e.preventDefault();
        setHighlightIndex((i) => Math.min(i + 1, filtered.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightIndex((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (highlightIndex >= 0 && highlightIndex < filtered.length) {
          selectOption(filtered[highlightIndex]);
        }
        break;
    }
  }, [filtered, highlightIndex, selectOption]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setOpen((prev) => {
            if (prev) {
              setSearch("");
              setHighlightIndex(-1);
            }
            return !prev;
          });
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        className={cn(
          "px-3 py-1.5 text-xs font-medium rounded-lg bg-white dark:bg-dark-raised border border-stone-200 dark:border-white/[0.06] text-stone-600 dark:text-neutral-400 cursor-pointer focus:outline-none focus:border-brand flex items-center gap-1.5",
          className,
        )}
      >
        <span className="truncate">{selectedLabel ?? placeholder}</span>
        <ChevronDown className="w-3 h-3 shrink-0 text-stone-400 dark:text-neutral-500" />
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
          className="z-50 bg-white dark:bg-dark-raised border border-stone-200 dark:border-white/[0.06] rounded-lg shadow-md py-1"
        >
          <div className="px-2 pb-1">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setHighlightIndex(-1); }}
              onKeyDown={handleKeyDown}
              placeholder="Search..."
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={highlightIndex >= 0 ? `${listboxId}-opt-${highlightIndex}` : undefined}
              className="w-full px-2 py-1 text-xs border border-stone-200 dark:border-white/[0.06] rounded bg-white dark:bg-dark-overlay text-stone-700 dark:text-neutral-300 focus:outline-none focus:border-brand"
            />
          </div>
          <div id={listboxId} role="listbox" className="max-h-[200px] overflow-y-auto">
            {filtered.map((option, i) => (
              <button
                key={option.value}
                id={`${listboxId}-opt-${i}`}
                type="button"
                role="option"
                aria-selected={option.value === value}
                onClick={() => selectOption(option)}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-xs text-stone-700 dark:text-neutral-300 hover:bg-stone-50 dark:hover:bg-white/[0.06] cursor-pointer",
                  option.value === value && "bg-stone-50 dark:bg-dark-overlay font-medium text-brand",
                  highlightIndex === i && "bg-stone-100 dark:bg-dark-overlay",
                )}
              >
                {option.label}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-1.5 text-xs text-stone-400 dark:text-neutral-500">No matches</div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
