import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/cn";

interface PersonOption {
  value: string;
  label: string;
}

interface PersonSelectProps {
  /** Selected values — single string or array for multi */
  value: string | string[] | null;
  onChange: (value: string | string[] | null) => void;
  options: PersonOption[];
  placeholder?: string;
  multi?: boolean;
  className?: string;
}

export function PersonSelect({
  value,
  onChange,
  options,
  placeholder = "All people",
  multi = false,
  className,
}: PersonSelectProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, flip: false });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selected = multi
    ? (Array.isArray(value) ? value : value ? [value] : [])
    : (typeof value === "string" ? value : null);

  const updatePos = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    setPos({
      top: spaceBelow < 240 ? rect.top - 4 : rect.bottom + 4,
      left: rect.left,
      width: Math.max(rect.width, 200),
      flip: spaceBelow < 240,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || dropdownRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    updatePos();
    window.addEventListener("scroll", updatePos, true);
    window.addEventListener("resize", updatePos);
    return () => {
      window.removeEventListener("scroll", updatePos, true);
      window.removeEventListener("resize", updatePos);
    };
  }, [open, updatePos]);

  const handleToggle = () => {
    if (!open) updatePos();
    setOpen(!open);
  };

  const handleSelect = (optValue: string) => {
    if (multi) {
      const arr = selected as string[];
      const next = arr.includes(optValue)
        ? arr.filter((v) => v !== optValue)
        : [...arr, optValue];
      onChange(next.length > 0 ? next : null);
    } else {
      onChange(optValue === selected ? null : optValue);
      setOpen(false);
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(multi ? null : null);
  };

  // Display label
  const selectedArr = multi ? (selected as string[]) : [];
  const singleLabel = !multi && selected
    ? options.find((o) => o.value === selected)?.label ?? (selected as string)
    : null;

  const hasValue = multi ? selectedArr.length > 0 : !!selected;

  return (
    <>
      <button
        ref={triggerRef}
        onClick={handleToggle}
        className={cn(
          "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer",
          "focus:outline-none focus:ring-2 focus:ring-accent/30",
          hasValue
            ? "border-accent/30 bg-accent/5 text-accent  "
            : "border-stone-200  bg-white  text-stone-600  hover:border-stone-300  ",
          className,
        )}
      >
        {multi && selectedArr.length > 0 ? (
          <>
            <span className="truncate max-w-[120px]">
              {selectedArr.length === 1
                ? options.find((o) => o.value === selectedArr[0])?.label ?? selectedArr[0]
                : `${selectedArr.length} selected`}
            </span>
            <X className="w-3 h-3 shrink-0 opacity-60 hover:opacity-100" onClick={handleClear} />
          </>
        ) : singleLabel ? (
          <>
            <span className="truncate max-w-[120px]">{singleLabel}</span>
            <X className="w-3 h-3 shrink-0 opacity-60 hover:opacity-100" onClick={handleClear} />
          </>
        ) : (
          <>
            <span>{placeholder}</span>
            <ChevronDown className="w-3 h-3 shrink-0 opacity-60" />
          </>
        )}
      </button>

      {open && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[200] bg-white border border-stone-200 rounded-lg shadow-lg overflow-hidden"
          style={{
            left: pos.left,
            width: pos.width,
            ...(pos.flip
              ? { bottom: window.innerHeight - pos.top, maxHeight: pos.top - 8 }
              : { top: pos.top, maxHeight: window.innerHeight - pos.top - 8 }),
          }}
        >
          <div className="overflow-y-auto max-h-[280px] py-1">
            {options.map((opt) => {
              const isSelected = multi
                ? (selected as string[]).includes(opt.value)
                : selected === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => handleSelect(opt.value)}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors cursor-pointer text-left",
                    isSelected
                      ? "bg-accent/5 text-accent"
                      : "text-stone-600  hover:bg-stone-50  ",
                  )}
                >
                  {multi && (
                    <div className={cn(
                      "w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                      isSelected
                        ? "bg-accent border-accent"
                        : "border-stone-300  ",
                    )}>
                      {isSelected && <Check className="w-3 h-3 text-white" />}
                    </div>
                  )}
                  <span className="truncate">{opt.label}</span>
                  {!multi && isSelected && (
                    <Check className="w-3.5 h-3.5 ml-auto shrink-0 text-accent" />
                  )}
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
