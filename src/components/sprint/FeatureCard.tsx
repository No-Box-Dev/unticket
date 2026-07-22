import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/cn";
import { AssignDropdown } from "./AssignDropdown";
import { withStatusTransition } from "@/lib/github-features";
import { daysAgo } from "@/lib/dates";
import type { BoardStage, Feature, FeatureStatus, Spec } from "@/lib/types";
import { Archive, ChevronDown, ExternalLink, FileText, GripVertical, Star, Trash2 } from "lucide-react";

interface FeatureCardProps {
  feature: Feature;
  stages: BoardStage[];
  allPeople: string[];
  /** Non-archived specs already scoped to this feature. SprintTab loads
   * the org's spec list once and passes each card its slice, so we
   * don't fan out N useSpecs subscriptions across a dense board. */
  ownSpecs: Spec[];
  onUpdate: (updated: Feature) => void;
  onDelete: (id: number) => void;
  onOpenDetail: (feature: Feature) => void;
  onSendToBacklog?: (feature: Feature) => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent, feature: Feature) => void;
  isAdmin?: boolean;
}

// Compact relative-date label for spec chips. Keeps the card readable at
// kanban-column width — days/weeks buckets, no seconds.
function relDays(iso: string): string {
  const d = daysAgo(iso);
  if (d <= 0) return "today";
  if (d === 1) return "1d";
  if (d < 7) return `${d}d`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w`;
  const m = Math.floor(d / 30);
  if (m < 12) return `${m}mo`;
  return `${Math.floor(d / 365)}y`;
}

export function FeatureCard({
  feature,
  stages,
  allPeople,
  ownSpecs,
  onUpdate,
  onDelete,
  onOpenDetail,
  onSendToBacklog,
  draggable,
  onDragStart,
  isAdmin,
}: FeatureCardProps) {
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };

  const isLastStage = stages.length > 0 && stages[stages.length - 1].id === feature.status;

  // One direct link keeps dense cards scannable. With multiple specs the
  // explicit primary wins; until one is selected, the newest spec (the API's
  // list order) remains the stable fallback.
  const directSpec = ownSpecs.find((s) => s.isPrimary) ?? ownSpecs[0];
  const overflowSpecs = directSpec ? ownSpecs.filter((s) => s.id !== directSpec.id) : [];

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!draggable) return;
    const idx = stages.findIndex((s) => s.id === feature.status);
    if (idx === -1) return;
    let targetStatus: FeatureStatus | null = null;
    if (e.key === "ArrowRight" && idx < stages.length - 1) targetStatus = stages[idx + 1].id;
    if (e.key === "ArrowLeft" && idx > 0) targetStatus = stages[idx - 1].id;
    if (targetStatus) {
      e.preventDefault();
      onUpdate(withStatusTransition(feature, targetStatus));
    }
  };

  return (
    <div
      draggable={draggable && !feature.pending}
      onDragStart={(e) => onDragStart?.(e, feature)}
      onKeyDown={handleKeyDown}
      role="listitem"
      aria-label={`${feature.title}, status: ${feature.status}`}
      tabIndex={draggable && !feature.pending ? 0 : undefined}
      className={cn(
        "group bg-white  rounded-lg border border-stone-200  p-3 shadow-sm hover:shadow-md transition-shadow",
        draggable && !feature.pending && "cursor-grab active:cursor-grabbing",
        isLastStage && "opacity-60",
        // Green left stripe = "this feature has specs". Same idea as the
        // retired amber stripe for missing-plan, inverted: now a visual
        // reward for well-specced features rather than a scolding for
        // empty ones.
        ownSpecs.length > 0 && "border-l-2 border-l-green-400",
        // Optimistic create in flight: faded + fully non-interactive until the
        // real issue number arrives (its temp negative id can't be PATCHed).
        feature.pending && "opacity-50 pointer-events-none",
      )}
    >
      {/* Row 1: grip + title */}
      <div className="flex items-start gap-2">
        {draggable && (
          <GripVertical className="w-4 h-4 text-stone-300 mt-0.5 shrink-0" />
        )}
        <button
          onClick={() => onOpenDetail(feature)}
          className="text-sm font-medium text-stone-800 text-left cursor-pointer hover:text-accent leading-snug"
        >
          {feature.title}
        </button>
      </div>

      {/* Row 2: assignee + hover actions. No stage-color bullet — the column
          header already conveys stage and the dot was visual noise here. */}
      <div className="flex items-center gap-2 mt-1.5 ml-6 flex-wrap">
        <AssignDropdown
          owners={feature.owners}
          allPeople={allPeople}
          onChange={(owners) => onUpdate({ ...feature, owners })}
        />
        <div className="flex-1 min-w-0" />
        <div className="flex items-center gap-1.5">
          {onSendToBacklog && (
            <button
              onClick={stop(() => onSendToBacklog(feature))}
              className="p-1 text-stone-300 hover:text-accent cursor-pointer rounded hover:bg-accent/10 opacity-0 group-hover:opacity-100 transition-opacity"
              title="Send to backlog"
              aria-label={`Send ${feature.title} to backlog`}
            >
              <Archive size={13} />
            </button>
          )}
          {isAdmin && (
            <button
              onClick={stop(() => onDelete(feature.id))}
              className="p-1 text-stone-300 hover:text-red-500 cursor-pointer rounded hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
              title="Remove"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Row 3: one direct spec link; any other specs stay available behind
          the compact overflow menu. */}
      {directSpec && (
        <div className="mt-2 ml-6 space-y-1">
          <SpecChip spec={directSpec} showPrimary={ownSpecs.length > 1 && directSpec.isPrimary} />
          {overflowSpecs.length > 0 && <SpecOverflow specs={overflowSpecs} />}
        </div>
      )}
    </div>
  );
}

// Effective primary link URL for a spec: explicit `primary: true` wins,
// otherwise the first link is the implicit primary. Returns null when the
// spec has no links at all — chip falls back to opening the spec detail.
function primaryUrl(spec: Spec): string | null {
  if (!spec.links.length) return null;
  const explicit = spec.links.find((l) => l.primary);
  return (explicit ?? spec.links[0]).url;
}

function SpecChip({ spec, showPrimary = false }: { spec: Spec; showPrimary?: boolean }) {
  const href = primaryUrl(spec) ?? `/?tab=specs&spec=${spec.id}`;
  const opensExternal = primaryUrl(spec) !== null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      onDragStart={(e) => e.preventDefault()}
      className="flex items-center gap-1.5 text-xs text-stone-600 hover:text-accent group/spec"
      title={opensExternal ? `Open primary link: ${href}` : spec.title}
    >
      {opensExternal ? (
        <ExternalLink size={11} className="shrink-0 text-stone-400 group-hover/spec:text-accent" />
      ) : (
        <FileText size={11} className="shrink-0 text-stone-400 group-hover/spec:text-accent" />
      )}
      {showPrimary && (
        <Star
          size={11}
          fill="currentColor"
          className="shrink-0 text-amber-500"
          aria-label="Primary spec"
        />
      )}
      <span className="truncate flex-1">
        {spec.title || <span className="text-stone-400">Untitled</span>}
      </span>
      <span className="shrink-0 text-[10px] text-stone-400 tabular-nums">
        {relDays(spec.updatedAt ?? spec.createdAt)}
      </span>
    </a>
  );
}

function SpecOverflow({ specs }: { specs: Spec[] }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="inline-flex items-center gap-1 text-[11px] text-stone-400 hover:text-accent cursor-pointer"
      >
        <ChevronDown size={11} className={cn("transition-transform", open && "rotate-180")} />
        +{specs.length} more spec{specs.length === 1 ? "" : "s"}
      </button>
      {open && (
        <div
          className="absolute left-0 top-full mt-1 z-30 min-w-[220px] max-w-[280px] bg-white border border-stone-200 rounded-lg shadow-md py-1"
          onClick={(e) => e.stopPropagation()}
        >
          {specs.map((s) => {
            const primary = primaryUrl(s);
            const href = primary ?? `/?tab=specs&spec=${s.id}`;
            const external = primary !== null;
            return (
            <a
              key={s.id}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              onDragStart={(e) => e.preventDefault()}
              className="flex items-center gap-2 px-3 py-1.5 text-xs text-stone-600 hover:bg-stone-50 hover:text-accent"
              title={external ? `Open primary link: ${href}` : s.title}
            >
              {external ? (
                <ExternalLink size={11} className="shrink-0 text-stone-400" />
              ) : (
                <FileText size={11} className="shrink-0 text-stone-400" />
              )}
              <span className="flex-1 truncate">
                {s.title || <span className="text-stone-400">Untitled</span>}
              </span>
              <span className="shrink-0 text-[10px] text-stone-400 tabular-nums">
                {relDays(s.updatedAt ?? s.createdAt)}
              </span>
            </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
