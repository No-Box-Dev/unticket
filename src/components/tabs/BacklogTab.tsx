import { useMemo, useState } from "react";
import { useSprint, useFeatures, usePeople, useSettings, useCreateFeature, useUpdateFeature, useDeleteFeature } from "@/hooks/useConfigRepo";
import { FeatureCard } from "@/components/sprint/FeatureCard";
import { FeatureDetailModal } from "@/components/sprint/FeatureDetailModal";
import { AddFeatureInput } from "@/components/sprint/AddFeatureInput";
import { useIsAdmin, useActiveMembers } from "@/hooks/useGitHub";
import type { Feature } from "@/lib/types";
import { Archive, ArrowUpDown } from "lucide-react";

type SortKey = "default" | "priority" | "title";

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2, none: 3 };

function sortFeatures(features: Feature[], key: SortKey): Feature[] {
  if (key === "default") return features;
  return [...features].sort((a, b) => {
    switch (key) {
      case "priority":
        return (PRIORITY_ORDER[a.priority ?? "none"] ?? 3) - (PRIORITY_ORDER[b.priority ?? "none"] ?? 3);
      case "title":
        return a.title.localeCompare(b.title);
      default:
        return 0;
    }
  });
}

export function BacklogTab() {
  const { data: sprint } = useSprint();
  const { data: features } = useFeatures();
  const { data: people } = usePeople();
  const { data: orgMembers } = useActiveMembers();
  const createFeatureMut = useCreateFeature();
  const updateFeatureMut = useUpdateFeature();
  const deleteFeatureMut = useDeleteFeature();
  const isAdmin = useIsAdmin();
  const { data: settings } = useSettings();
  const [detailFeature, setDetailFeature] = useState<Feature | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>("title");

  const allPeopleNames = useMemo(
    () => (orgMembers ?? []).map((m) => m.login),
    [orgMembers],
  );

  const allTeamNames = useMemo(
    () => (settings?.teams ?? []).map((t) => t.name),
    [settings],
  );

  const futureFeatures = useMemo(
    () => (features ?? []).filter((f) => f.status === "future"),
    [features],
  );

  const sortedFeatures = useMemo(
    () => sortFeatures(futureFeatures, sortBy),
    [futureFeatures, sortBy],
  );

  const updateFeature = (updated: Feature) => {
    updateFeatureMut.mutate(updated);
    if (detailFeature?.id === updated.id) {
      setDetailFeature(updated);
    }
  };

  const deleteFeature = (id: number) => {
    deleteFeatureMut.mutate(id);
  };

  const addFeature = (title: string) => {
    createFeatureMut.mutate({
      title,
      status: "future",
      sprint: null,
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Archive className="w-5 h-5 text-stone-400 dark:text-neutral-500" />
          <div>
            <h2 className="text-lg font-semibold text-stone-800 dark:text-neutral-200 font-display">Backlog</h2>
            <p className="text-sm text-stone-500 dark:text-neutral-400">
              Future features — {futureFeatures.length} total
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <ArrowUpDown size={13} className="text-stone-400 dark:text-neutral-500" />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            className="px-2 py-1 rounded-md border border-stone-200 dark:border-white/[0.06] bg-white dark:bg-dark-raised text-xs text-stone-500 dark:text-neutral-400 focus:outline-none focus:border-brand cursor-pointer"
          >
            <option value="default">Default order</option>
            <option value="priority">Priority</option>
            <option value="title">Title A-Z</option>
          </select>
        </div>
      </div>

      {/* Flat feature list */}
      <div className="bg-white dark:bg-dark-raised rounded-xl border border-stone-200 dark:border-white/[0.06] overflow-hidden">
        <div className="p-2 space-y-0.5">
          {sortedFeatures.map((feature) => (
            <FeatureCard
              key={feature.id}
              feature={feature}
              allPeople={allPeopleNames}
              allTeams={allTeamNames}
              onUpdate={updateFeature}
              onDelete={deleteFeature}
              onOpenDetail={setDetailFeature}
              mode="backlog"
              isAdmin={isAdmin}
              currentSprint={sprint?.number}
            />
          ))}
          {sortedFeatures.length === 0 && (
            <div className="px-3 py-4 text-sm text-stone-400 dark:text-neutral-500 text-center">
              No backlog features
            </div>
          )}
          <div className="px-2">
            <AddFeatureInput onAdd={addFeature} />
          </div>
        </div>
      </div>

      {/* Detail modal */}
      {detailFeature && (
        <FeatureDetailModal
          key={detailFeature.id}
          feature={detailFeature}
          allPeople={allPeopleNames}
          onClose={() => setDetailFeature(null)}
          onUpdate={updateFeature}
        />
      )}
    </div>
  );
}
