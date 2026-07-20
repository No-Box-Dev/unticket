import { useCallback, useState } from "react";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
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
export function SpecLinksSection({ value, onChange, label = "Spec links" }: SpecLinksSectionProps) {
  const [rows, setRows] = useState<SpecLink[]>(() =>
    value.length
      ? value.map((l) => ({ url: l.url, label: l.label ?? "" }))
      : [{ url: "", label: "" }],
  );

  const commit = useCallback(
    (next: SpecLink[]) => {
      const cleaned = next
        .map((r) => ({ url: r.url.trim(), label: (r.label ?? "").trim() }))
        .filter((r) => isHttpUrl(r.url))
        .map((r) => (r.label ? { url: r.url, label: r.label } : { url: r.url }));
      onChange(cleaned);
    },
    [onChange],
  );

  function updateRow(i: number, patch: Partial<SpecLink>) {
    const next = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
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

  return (
    <div>
      <span className="text-xs text-stone-500 block mb-1.5">{label}</span>
      <div className="space-y-2">
        {rows.map((row, i) => {
          const valid = isHttpUrl(row.url);
          return (
            <div key={i} className="flex items-center gap-2">
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
