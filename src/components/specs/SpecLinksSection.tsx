import { useCallback, useState } from "react";
import { ExternalLink, Plus, Star, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { SpecLink } from "@/lib/types";

// Spec links render as clickable anchors, so guard the href the same way the
// server sanitizer does — http(s) only, never javascript:/data: — before we
// show the open icon or trust the URL.
function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

interface SpecLinksSectionProps {
  value: SpecLink[];
  onChange: (links: SpecLink[]) => void;
  label?: string;
}

// One link row is always shown as the basis; "Add link" appends as many more
// as the user wants. The editable buffer keeps empty / in-progress rows that
// the parent draft never stores — only http(s) rows with a URL are committed
// upward, and the server re-sanitizes on save.
//
// When there are 2+ valid links, each row gets a star button. Toggling the
// star marks that link primary and unsets any others — external chip-clicks
// on the FeatureCard open the primary link. With one link the star is
// implicit and hidden.
export function SpecLinksSection({ value, onChange, label = "Spec links" }: SpecLinksSectionProps) {
  const [rows, setRows] = useState<SpecLink[]>(() =>
    value.length
      ? value.map((l) => ({ url: l.url, label: l.label ?? "", primary: l.primary }))
      : [{ url: "", label: "" }],
  );

  const commit = useCallback(
    (next: SpecLink[]) => {
      const validRows = next
        .map((r) => ({
          url: r.url.trim(),
          label: (r.label ?? "").trim(),
          primary: !!r.primary,
        }))
        .filter((r) => isHttpUrl(r.url));
      // Enforce at-most-one-primary on the way out too (server also enforces).
      let sawPrimary = false;
      const cleaned = validRows.map((r) => {
        const isPrimary = r.primary && !sawPrimary;
        if (isPrimary) sawPrimary = true;
        const base: SpecLink = r.label ? { url: r.url, label: r.label } : { url: r.url };
        return isPrimary ? { ...base, primary: true } : base;
      });
      onChange(cleaned);
    },
    [onChange],
  );

  function updateRow(i: number, patch: Partial<SpecLink>) {
    const next = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    setRows(next);
    commit(next);
  }

  function markPrimary(i: number) {
    const next = rows.map((r, idx) => ({ ...r, primary: idx === i }));
    setRows(next);
    commit(next);
  }

  function clearPrimary() {
    const next = rows.map((r) => ({ ...r, primary: false }));
    setRows(next);
    commit(next);
  }

  function addRow() {
    setRows([...rows, { url: "", label: "" }]);
  }

  function removeRow(i: number) {
    const filtered = rows.filter((_, idx) => idx !== i);
    const next = filtered.length ? filtered : [{ url: "", label: "" }];
    setRows(next);
    commit(next);
  }

  const validCount = rows.filter((r) => isHttpUrl(r.url)).length;
  const showPrimaryStars = validCount > 1;
  const primaryIdx = rows.findIndex((r) => r.primary && isHttpUrl(r.url));

  return (
    <div>
      <span className="text-xs text-stone-500 block mb-1.5">{label}</span>
      <div className="space-y-2">
        {rows.map((row, i) => {
          const valid = isHttpUrl(row.url);
          const isPrimary = valid && (row.primary || (primaryIdx === -1 && i === 0));
          return (
            <div key={i} className="flex items-center gap-2">
              {showPrimaryStars && valid && (
                <button
                  type="button"
                  onClick={() => (row.primary ? clearPrimary() : markPrimary(i))}
                  className={cn(
                    "shrink-0 cursor-pointer",
                    isPrimary ? "text-amber-500" : "text-stone-300 hover:text-amber-400",
                  )}
                  title={row.primary ? "Primary link (click to unset)" : "Mark as primary"}
                  aria-label={row.primary ? "Unset primary link" : "Mark as primary link"}
                  aria-pressed={!!row.primary}
                >
                  <Star size={14} fill={isPrimary ? "currentColor" : "none"} />
                </button>
              )}
              <input
                value={row.label ?? ""}
                onChange={(e) => updateRow(i, { label: e.target.value })}
                placeholder="Label (optional)"
                className="w-1/3 rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-xs text-stone-700 focus:outline-none focus:border-accent"
              />
              <input
                value={row.url}
                onChange={(e) => updateRow(i, { url: e.target.value })}
                placeholder="https://…"
                className="flex-1 rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-xs text-stone-700 focus:outline-none focus:border-accent"
              />
              {valid && (
                <a
                  href={row.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-stone-400 hover:text-accent"
                  title="Open link"
                  aria-label="Open link"
                >
                  <ExternalLink size={14} />
                </a>
              )}
              <button
                type="button"
                onClick={() => removeRow(i)}
                className="shrink-0 text-stone-300 hover:text-red-500 cursor-pointer"
                title="Remove link"
                aria-label="Remove link"
              >
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={addRow}
        className="mt-2 inline-flex items-center gap-1 text-xs text-stone-400 hover:text-accent cursor-pointer"
      >
        <Plus size={12} /> Add link
      </button>
    </div>
  );
}
