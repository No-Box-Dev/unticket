import { useMemo } from "react";
import { useFeatures, useSprint, useSprintSnapshots, usePeople } from "@/hooks/useConfigRepo";
import { Spinner } from "@/components/Spinner";
import { cn } from "@/lib/cn";
import { Rocket, Calendar, ExternalLink, Users, ChevronRight } from "lucide-react";
import type { Feature, SprintSnapshot } from "@/lib/types";

const card = "bg-white dark:bg-dark-raised border border-stone-200 dark:border-white/[0.06] rounded-xl";

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatRelativeDate(dateStr: string): string {
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

interface ReleaseGroup {
  label: string;
  sprintNumber: number | null;
  date: string; // ISO date for sorting
  features: (Feature & { shippedAt: string })[];
}

export function ReleasesTab() {
  const { data: features, isLoading } = useFeatures();
  const { data: sprint } = useSprint();
  const { data: snapshots } = useSprintSnapshots();
  const { data: people } = usePeople();

  const nameOf = (login: string) => people?.find((p) => p.github === login)?.name ?? login;

  // Build release groups: features that reached production, grouped by sprint
  const releases = useMemo(() => {
    if (!features) return [];

    const productionFeatures = features.filter((f) => f.status === "production");
    const groups = new Map<string, ReleaseGroup>();

    for (const f of productionFeatures) {
      // Find when it shipped (latest production entry in statusHistory)
      const prodEntries = (f.statusHistory ?? []).filter((h) => h.status === "production");
      const shippedAt = prodEntries.length > 0
        ? prodEntries[prodEntries.length - 1].timestamp
        : new Date().toISOString();

      const sprintNum = f.sprint;
      const key = sprintNum !== null ? `sprint-${sprintNum}` : "unplanned";
      const label = sprintNum !== null ? `Sprint ${sprintNum}` : "Unplanned";

      if (!groups.has(key)) {
        // Find sprint dates from snapshots or current sprint
        let date = shippedAt;
        if (sprintNum !== null) {
          const snap = (snapshots ?? []).find((s: SprintSnapshot) => s.sprintNumber === sprintNum);
          if (snap) date = snap.endDate ?? shippedAt;
          else if (sprint && sprint.number === sprintNum) date = sprint.endDate;
        }
        groups.set(key, { label, sprintNumber: sprintNum, date, features: [] });
      }
      groups.get(key)!.features.push({ ...f, shippedAt });
    }

    return Array.from(groups.values())
      .sort((a, b) => b.date.localeCompare(a.date)); // newest first
  }, [features, sprint, snapshots]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  if (releases.length === 0) {
    return (
      <div className="text-center py-20">
        <Rocket className="w-12 h-12 mx-auto text-stone-300 dark:text-neutral-600 mb-3" />
        <p className="text-sm text-stone-400 dark:text-neutral-500">No features shipped yet</p>
      </div>
    );
  }

  const totalShipped = releases.reduce((sum, r) => sum + r.features.length, 0);

  return (
    <div className="space-y-6">
      {/* Summary header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-stone-800 dark:text-neutral-200 font-display">Releases</h2>
          <p className="text-xs text-stone-400 dark:text-neutral-500 mt-0.5">
            {totalShipped} feature{totalShipped !== 1 ? "s" : ""} shipped across {releases.length} release{releases.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Timeline */}
      <div className="relative">
        {/* Vertical timeline line */}
        <div className="absolute left-[19px] top-0 bottom-0 w-px bg-stone-200 dark:bg-white/[0.06]" />

        <div className="space-y-6">
          {releases.map((release) => (
            <div key={release.label} className="relative pl-12">
              {/* Timeline dot */}
              <div className="absolute left-2.5 top-1 w-4 h-4 rounded-full bg-brand border-2 border-white dark:border-dark-base" />

              {/* Release header */}
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-semibold text-stone-800 dark:text-neutral-200">
                  {release.label}
                </h3>
                <span className="text-xs text-stone-400 dark:text-neutral-500 flex items-center gap-1">
                  <Calendar size={12} />
                  {formatDate(release.date)}
                </span>
                <span className="text-xs text-stone-400 dark:text-neutral-500">
                  ({formatRelativeDate(release.date)})
                </span>
                <span className="ml-auto text-xs font-medium text-brand">
                  {release.features.length} feature{release.features.length !== 1 ? "s" : ""}
                </span>
              </div>

              {/* Feature cards */}
              <div className="space-y-2">
                {release.features.map((f) => (
                  <div
                    key={f.id}
                    className={cn(card, "p-4 hover:border-stone-300 dark:hover:border-white/[0.12] transition-colors")}
                  >
                    <div className="flex items-start gap-3">
                      <div className="p-1.5 bg-green-50 dark:bg-green-950 rounded-lg shrink-0 mt-0.5">
                        <Rocket size={14} className="text-green-600 dark:text-green-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-stone-800 dark:text-neutral-200 truncate">
                            {f.title}
                          </span>
                          {f.url && (
                            <a
                              href={f.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-stone-400 hover:text-brand transition-colors shrink-0"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <ExternalLink size={12} />
                            </a>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1.5">
                          {f.owners.length > 0 && (
                            <span className="flex items-center gap-1 text-xs text-stone-400 dark:text-neutral-500">
                              <Users size={11} />
                              {f.owners.map(nameOf).join(", ")}
                            </span>
                          )}
                          <span className="text-xs text-stone-400 dark:text-neutral-500">
                            Shipped {formatRelativeDate(f.shippedAt)}
                          </span>
                        </div>
                      </div>
                      <ChevronRight size={14} className="text-stone-300 dark:text-neutral-600 shrink-0 mt-1" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
