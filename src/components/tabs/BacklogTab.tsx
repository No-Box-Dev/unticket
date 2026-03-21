import { useMemo, useState, useEffect, useCallback } from "react";
import { useSprint, useFeatures, useCreateFeature, useUpdateFeature, useDeleteFeature } from "@/hooks/useConfigRepo";
import { FeatureCard } from "@/components/sprint/FeatureCard";
import { FeatureDetailModal } from "@/components/sprint/FeatureDetailModal";
import { AddFeatureInput } from "@/components/sprint/AddFeatureInput";
import { Spinner } from "@/components/Spinner";
import { useIsAdmin, useActiveMembers } from "@/hooks/useGitHub";
import type { Feature } from "@/lib/types";
import { Archive, ArrowUpDown } from "lucide-react";

type SortKey = "default" | "title";

function sortFeatures(features: Feature[], key: SortKey): Feature[] {
  if (key === "default") return features;
  return [...features].sort((a, b) => {
    switch (key) {
      case "title":
        return a.title.localeCompare(b.title);
      default:
        return 0;
    }
  });
}

export function BacklogTab({ urlFeatureId, onUrlChange }: { urlFeatureId?: number; onUrlChange?: (featureId: number | null) => void }) {
  const { data: sprint } = useSprint();
  const { data: features, isLoading: featuresLoading } = useFeatures();
  const { data: orgMembers } = useActiveMembers();
  const createFeatureMut = useCreateFeature();
  const updateFeatureMut = useUpdateFeature();
  const deleteFeatureMut = useDeleteFeature();
  const isAdmin = useIsAdmin();
  const [detailFeature, setDetailFeature] = useState<Feature | null>(null);

  // Open/close feature from URL
  useEffect(() => {
    if (!features) return;
    if (urlFeatureId) {
      if (detailFeature?.id !== urlFeatureId) {
        const f = features.find((feat) => feat.id === urlFeatureId);
        if (f) setDetailFeature(f);
      }
    } else if (detailFeature) {
      setDetailFeature(null);
    }
  }, [urlFeatureId, features]); // eslint-disable-line react-hooks/exhaustive-deps

  const openDetail = useCallback((f: Feature) => {
    setDetailFeature(f);
    onUrlChange?.(f.id);
  }, [onUrlChange]);

  const closeDetail = useCallback(() => {
    setDetailFeature(null);
    onUrlChange?.(null);
  }, [onUrlChange]);

  const [sortBy, setSortBy] = useState<SortKey>("title");

  const allPeopleNames = useMemo(
    () => (orgMembers ?? []).map((m) => m.login),
    [orgMembers],
  );

  const futureFeatures = useMemo(
    () => (features ?? []).filter((f) => f.status === "future"),
    [features],
  );

  const sprintOptions = useMemo(() => {
    const opts: { value: number | null; label: string }[] = [];
    if (sprint) opts.push({ value: sprint.number, label: `Sprint ${sprint.number}` });
    // Detect future sprint numbers from features
    const futureNums = new Set<number>();
    for (const f of features ?? []) {
      if (f.sprint !== null && sprint && f.sprint > sprint.number) futureNums.add(f.sprint);
    }
    for (const num of [...futureNums].sort((a, b) => a - b)) {
      opts.push({ value: num, label: `Sprint ${num} (upcoming)` });
    }
    const nextNum = (sprint?.number ?? 0) + 1;
    if (!opts.some((o) => o.value === nextNum)) {
      opts.push({ value: nextNum, label: `Sprint ${nextNum} (new)` });
    }
    opts.push({ value: null, label: "Backlog" });
    return opts;
  }, [sprint, features]);

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

  if (featuresLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

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
              onUpdate={updateFeature}
              onDelete={deleteFeature}
              onOpenDetail={openDetail}
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
          onClose={closeDetail}
          onUpdate={updateFeature}
          sprintOptions={sprintOptions}
        />
      )}
    </div>
  );
}
