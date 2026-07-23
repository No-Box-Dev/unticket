import { useMemo } from "react";
import { Archive, ChevronDown, ChevronRight, FileText, Inbox, Layers, Rocket } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { useBoardStages } from "@/lib/board-stages";
import type { Feature, Spec } from "@/lib/types";

export type SidebarSelection =
  | { kind: "all" }
  | { kind: "unfiled" }
  | { kind: "feature"; featureNumber: number }
  | { kind: "archive" };

interface Props {
  selection: SidebarSelection;
  onSelect: (sel: SidebarSelection) => void;
  features: Feature[];
  specs: Spec[];             // active + archived, org-wide — used for counts
  archivedCount: number;
}

// Sidebar for the Specs tab under the unified model: every feature is a
// grouping, including features that do not have a spec yet. Grouped by
// kanban stage for skimmability.
export function SpecFeatureSidebar({
  selection,
  onSelect,
  features,
  specs,
  archivedCount,
}: Props) {
  const stages = useBoardStages();
  const [archiveOpen, setArchiveOpen] = useState(selection.kind === "archive");

  const activeSpecs = useMemo(() => specs.filter((s) => !s.archived), [specs]);

  const specCountByFeature = useMemo(() => {
    const m = new Map<number, number>();
    for (const s of activeSpecs) {
      if (s.featureNumber == null) continue;
      m.set(s.featureNumber, (m.get(s.featureNumber) ?? 0) + 1);
    }
    return m;
  }, [activeSpecs]);

  const unfiledCount = useMemo(
    () => activeSpecs.filter((s) => s.featureNumber == null).length,
    [activeSpecs],
  );

  const allActiveCount = activeSpecs.length;

  // Group every feature by stage. Any feature whose status isn't in the
  // current stage set falls into a synthetic "Other" bucket so the sidebar
  // never silently hides it.
  const grouped = useMemo(() => {
    const stageIds = new Set(stages.map((s) => s.id));
    const byStage = new Map<string, Feature[]>();
    for (const s of stages) byStage.set(s.id, []);
    const other: Feature[] = [];
    for (const f of features) {
      if (stageIds.has(f.status)) byStage.get(f.status)!.push(f);
      else other.push(f);
    }
    for (const [id, list] of byStage) {
      byStage.set(id, list.sort((a, b) => a.title.localeCompare(b.title)));
    }
    return { byStage, other: other.sort((a, b) => a.title.localeCompare(b.title)) };
  }, [features, stages]);

  const isActive = (sel: SidebarSelection) => {
    if (selection.kind !== sel.kind) return false;
    if (selection.kind === "feature" && sel.kind === "feature") {
      return selection.featureNumber === sel.featureNumber;
    }
    return true;
  };

  return (
    <aside className="space-y-4">
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 px-2 mb-1">
          Overview
        </div>
        <ul className="space-y-0.5">
          <SidebarItem
            active={isActive({ kind: "all" })}
            onClick={() => onSelect({ kind: "all" })}
            icon={<Layers size={14} />}
            label="All specs"
            count={allActiveCount}
          />
          <SidebarItem
            active={isActive({ kind: "unfiled" })}
            onClick={() => onSelect({ kind: "unfiled" })}
            icon={<Inbox size={14} />}
            label="Unfiled"
            count={unfiledCount}
          />
        </ul>
      </div>

      {stages.map((stage) => {
        const list = grouped.byStage.get(stage.id) ?? [];
        if (list.length === 0) return null;
        return (
          <div key={stage.id}>
            <div className="flex items-center gap-1.5 px-2 mb-1">
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ backgroundColor: stage.color }}
              />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">
                {stage.label}
              </span>
            </div>
            <ul className="space-y-0.5">
              {list.map((f) => (
                <FeatureRow
                  key={f.id}
                  feature={f}
                  active={isActive({ kind: "feature", featureNumber: f.id })}
                  onSelect={() => onSelect({ kind: "feature", featureNumber: f.id })}
                  count={specCountByFeature.get(f.id) ?? 0}
                />
              ))}
            </ul>
          </div>
        );
      })}

      {grouped.other.length > 0 && (
        <div>
          <div className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-wider text-stone-400">
            Other
          </div>
          <ul className="space-y-0.5">
            {grouped.other.map((f) => (
              <FeatureRow
                key={f.id}
                feature={f}
                active={isActive({ kind: "feature", featureNumber: f.id })}
                onSelect={() => onSelect({ kind: "feature", featureNumber: f.id })}
                count={specCountByFeature.get(f.id) ?? 0}
              />
            ))}
          </ul>
        </div>
      )}

      {(archivedCount > 0 || archiveOpen) && (
        <div>
          <button
            onClick={() => {
              const next = !archiveOpen;
              setArchiveOpen(next);
              if (next && selection.kind !== "archive") onSelect({ kind: "archive" });
            }}
            className="w-full flex items-center gap-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-stone-400 hover:text-stone-600 cursor-pointer"
          >
            {archiveOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <Archive size={12} />
            Archive
            {archivedCount > 0 && (
              <span className="ml-1 text-stone-400">({archivedCount})</span>
            )}
          </button>
          {archiveOpen && (
            <ul className="mt-1 space-y-0.5">
              <SidebarItem
                active={isActive({ kind: "archive" })}
                onClick={() => onSelect({ kind: "archive" })}
                icon={<Archive size={14} />}
                label="Archived specs"
              />
            </ul>
          )}
        </div>
      )}
    </aside>
  );
}

function SidebarItem({
  active, onClick, icon, label, count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
}) {
  return (
    <li>
      <button
        onClick={onClick}
        className={cn(
          "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-left cursor-pointer",
          active
            ? "bg-accent/10 text-accent font-medium"
            : "text-stone-600 hover:bg-stone-100",
        )}
      >
        <span className="shrink-0">{icon}</span>
        <span className="flex-1 truncate">{label}</span>
        {count !== undefined && count > 0 && (
          <span className="text-[10px] text-stone-400">{count}</span>
        )}
      </button>
    </li>
  );
}

function FeatureRow({
  feature, active, onSelect, count,
}: {
  feature: Feature;
  active: boolean;
  onSelect: () => void;
  count: number;
}) {
  return (
    <li>
      <button
        onClick={onSelect}
        className={cn(
          "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-left cursor-pointer",
          active
            ? "bg-accent/10 text-accent font-medium"
            : "text-stone-600 hover:bg-stone-100",
        )}
        title={feature.title}
      >
        <Rocket size={12} className="shrink-0 text-stone-400" />
        <span className="flex-1 truncate">{feature.title || <span className="text-stone-400">Untitled</span>}</span>
        <span className="text-[10px] text-stone-400">{count}</span>
      </button>
    </li>
  );
}

// Re-export FileText so callers can use it for the "Unfiled" empty state icon.
export { FileText };
