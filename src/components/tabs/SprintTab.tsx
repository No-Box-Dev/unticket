import { useMemo, useState, useCallback } from "react";
import { useSprint, useFeatures, usePeople, useSaveFeatures, useCreateConfigRepo } from "@/hooks/useConfigRepo";
import { FeatureCard } from "@/components/sprint/FeatureCard";
import { FeatureDetailModal } from "@/components/sprint/FeatureDetailModal";
import { AddFeatureInput } from "@/components/sprint/AddFeatureInput";
import type { Feature, FeatureStatus, Priority } from "@/lib/types";
import { Calendar, Rocket, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/cn";

type SortKey = "default" | "priority" | "effort" | "title";

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2, none: 3 };
const EFFORT_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

function sortFeatures(features: Feature[], key: SortKey): Feature[] {
  if (key === "default") return features;
  return [...features].sort((a, b) => {
    switch (key) {
      case "priority":
        return (PRIORITY_ORDER[a.priority ?? "none"] ?? 3) - (PRIORITY_ORDER[b.priority ?? "none"] ?? 3);
      case "effort":
        return (EFFORT_ORDER[a.effort] ?? 1) - (EFFORT_ORDER[b.effort] ?? 1);
      case "title":
        return a.title.localeCompare(b.title);
      default:
        return 0;
    }
  });
}

interface SprintTabProps {
  repoNames: string[];
}

export function SprintTab({ repoNames: _repoNames }: SprintTabProps) {
  const { data: sprint, isLoading: sprintLoading } = useSprint();
  const { data: features } = useFeatures();
  const { data: people } = usePeople();
  const saveFeatures = useSaveFeatures();
  const createRepo = useCreateConfigRepo();

  const [detailFeature, setDetailFeature] = useState<Feature | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>("default");

  const allPeopleNames = useMemo(
    () => (people ?? []).map((p) => p.github),
    [people],
  );

  // Flat sprint features (no team grouping)
  const sprintFeatures = useMemo(() => {
    return (features ?? []).filter(
      (f) => f.sprint === sprint?.number && f.status !== "future",
    );
  }, [features, sprint]);

  const planFeatures = useMemo(
    () => sprintFeatures.filter((f) => f.status === "plan"),
    [sprintFeatures],
  );

  const demoFeatures = useMemo(
    () => sprintFeatures.filter((f) => f.status === "demo"),
    [sprintFeatures],
  );

  const productionFeatures = useMemo(
    () => sprintFeatures.filter((f) => f.status === "production"),
    [sprintFeatures],
  );

  const sortedColumns = useMemo(() => ({
    plan: sortFeatures(planFeatures, sortBy),
    demo: sortFeatures(demoFeatures, sortBy),
    production: sortFeatures(productionFeatures, sortBy),
  }), [planFeatures, demoFeatures, productionFeatures, sortBy]);

  const [dragOverCol, setDragOverCol] = useState<FeatureStatus | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, feature: Feature) => {
    e.dataTransfer.setData("text/plain", feature.id);
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetStatus: FeatureStatus) => {
    e.preventDefault();
    setDragOverCol(null);
    const featureId = e.dataTransfer.getData("text/plain");
    const all = features ?? [];
    const feature = all.find((f) => f.id === featureId);
    if (!feature || feature.status === targetStatus) return;
    const next = all.map((f) => (f.id === featureId ? { ...f, status: targetStatus } : f));
    saveFeatures.mutate(next);
    if (detailFeature?.id === featureId) {
      setDetailFeature({ ...feature, status: targetStatus });
    }
  }, [features, saveFeatures, detailFeature]);

  const handleDragOver = useCallback((e: React.DragEvent, status: FeatureStatus) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverCol(status);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverCol(null);
  }, []);

  const updateFeature = (updated: Feature) => {
    const all = features ?? [];
    const next = all.map((f) => (f.id === updated.id ? updated : f));
    saveFeatures.mutate(next);
    if (detailFeature?.id === updated.id) {
      setDetailFeature(updated);
    }
  };

  const deleteFeature = (id: string) => {
    const all = features ?? [];
    saveFeatures.mutate(all.filter((f) => f.id !== id));
  };

  const addFeature = (title: string) => {
    const all = features ?? [];
    const newFeature: Feature = {
      id: `feat-${Date.now()}`,
      title,
      owners: [],
      status: "plan",
      sprint: sprint?.number ?? null,
      effort: "medium",
    };
    saveFeatures.mutate([...all, newFeature]);
  };

  if (sprintLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-stone-400">
        Loading sprint...
      </div>
    );
  }

  if (!sprint) {
    return (
      <div className="text-center py-16">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-brand/10 mb-4">
          <Rocket className="w-7 h-7 text-brand" />
        </div>
        <h3 className="text-lg font-semibold text-stone-700 mb-1">No sprint configured yet</h3>
        <p className="text-sm text-stone-400 mb-6 max-w-sm mx-auto">
          Create a <code className="bg-stone-100 px-1 rounded">.gitpulse</code> config repo to start tracking sprints, features, and your team.
        </p>
        <button
          onClick={() => createRepo.mutate()}
          disabled={createRepo.isPending}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand text-white text-sm font-medium rounded-lg hover:bg-brand/90 transition-colors disabled:opacity-50 cursor-pointer"
        >
          {createRepo.isPending ? "Setting up..." : "Set Up GitPulse"}
        </button>
        {createRepo.isError && (
          <p className="text-sm text-red-500 mt-3">
            {(createRepo.error as any)?.message ?? "Failed to create config repo"}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex gap-4 pb-8">
      {/* Left sidebar: Sprint info + Add Feature */}
      <div className="hidden lg:flex flex-col gap-4 w-48 shrink-0 pt-1">
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-stone-800">
            Sprint {sprint.number}
          </h2>
          <p className="text-xs text-stone-500">{sprint.name}</p>
          <div className="flex items-center gap-1.5 text-xs text-stone-400">
            <Calendar className="w-3.5 h-3.5" />
            {formatDate(sprint.startDate)} – {formatDate(sprint.endDate)}
          </div>
          {sprint.focus && (
            <p className="text-xs text-brand">{sprint.focus}</p>
          )}
        </div>
        <div className="border-t border-stone-200 pt-3">
          <AddFeatureInput onAdd={addFeature} />
        </div>
      </div>

      {/* Mobile: inline sprint header */}
      <div className="lg:hidden w-full space-y-3 mb-4">
        <div className="bg-white rounded-xl border border-stone-200 border-l-4 border-l-brand px-4 py-2.5 flex items-center gap-3">
          <h2 className="text-sm font-semibold text-stone-800 whitespace-nowrap">
            Sprint {sprint.number}: {sprint.name}
          </h2>
          <div className="flex items-center gap-1.5 text-xs text-stone-400 whitespace-nowrap">
            <Calendar className="w-3.5 h-3.5" />
            {formatDate(sprint.startDate)} – {formatDate(sprint.endDate)}
          </div>
        </div>
        <AddFeatureInput onAdd={addFeature} />
      </div>

      {/* Kanban columns: Plan | Demo | Production */}
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center justify-end">
          <div className="flex items-center gap-1.5">
            <ArrowUpDown size={13} className="text-stone-400" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              className="px-2 py-1 rounded-md border border-stone-200 bg-white text-xs text-stone-500 focus:outline-none focus:border-brand cursor-pointer"
            >
              <option value="default">Default order</option>
              <option value="priority">Priority</option>
              <option value="effort">Effort</option>
              <option value="title">Title A-Z</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {(
          [
            { status: "plan" as const, label: "Plan", items: sortedColumns.plan },
            { status: "demo" as const, label: "Demo", items: sortedColumns.demo },
            { status: "production" as const, label: "Production", items: sortedColumns.production },
          ] as const
        ).map(({ status, label, items }) => (
          <div
            key={status}
            onDragOver={(e) => handleDragOver(e, status)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, status)}
            className={cn(
              "rounded-xl border border-stone-200 bg-stone-50 transition-colors",
              dragOverCol === status && "border-brand/50 bg-brand/5",
            )}
          >
            <div className="px-4 py-3 border-b border-stone-100 bg-white rounded-t-xl">
              <span className="text-sm font-medium text-stone-700">
                {label}{" "}
                <span className="text-stone-400 font-normal">({items.length})</span>
              </span>
            </div>
            <div className="p-2 pb-3 space-y-2 overflow-y-auto max-h-[calc(100vh-220px)]">
              {items.map((feature) => (
                <FeatureCard
                  key={feature.id}
                  feature={feature}
                  allPeople={allPeopleNames}
                  onUpdate={updateFeature}
                  onDelete={deleteFeature}
                  onOpenDetail={setDetailFeature}
                  mode="sprint"
                  draggable
                  onDragStart={handleDragStart}
                />
              ))}
              {items.length === 0 && (
                <div className="px-3 py-8 text-sm text-stone-400 text-center">
                  Drag features here
                </div>
              )}
            </div>
          </div>
        ))}
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

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
