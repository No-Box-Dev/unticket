import { useMemo, useState, useCallback } from "react";
import { useSprint, useFeatures, usePeople, useSaveFeatures, useCreateConfigRepo } from "@/hooks/useConfigRepo";
import { FeatureCard } from "@/components/sprint/FeatureCard";
import { FeatureDetailModal } from "@/components/sprint/FeatureDetailModal";
import { AddFeatureInput } from "@/components/sprint/AddFeatureInput";
import type { Feature, FeatureStatus } from "@/lib/types";
import { Calendar, Rocket } from "lucide-react";
import { cn } from "@/lib/cn";

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
    <div className="space-y-6">
      {/* Sprint Header */}
      <div className="bg-white rounded-xl border border-stone-200 border-l-4 border-l-brand px-4 py-2.5">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-stone-800">
            Sprint {sprint.number}: {sprint.name}
          </h2>
          <div className="flex items-center gap-1.5 text-xs text-stone-400">
            <Calendar className="w-3.5 h-3.5" />
            {formatDate(sprint.startDate)} – {formatDate(sprint.endDate)}
          </div>
          {sprint.focus && (
            <span className="text-xs text-brand">{sprint.focus}</span>
          )}
        </div>
      </div>

      {/* Add feature input */}
      <div className="px-1">
        <AddFeatureInput onAdd={addFeature} />
      </div>

      {/* Kanban columns: Plan | Demo | Production */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {(
          [
            { status: "plan" as const, label: "Plan", items: planFeatures },
            { status: "demo" as const, label: "Demo", items: demoFeatures },
            { status: "production" as const, label: "Production", items: productionFeatures },
          ] as const
        ).map(({ status, label, items }) => (
          <div
            key={status}
            onDragOver={(e) => handleDragOver(e, status)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, status)}
            className={cn(
              "rounded-xl border border-stone-200 overflow-hidden bg-stone-50 transition-colors",
              dragOverCol === status && "border-brand/50 bg-brand/5",
            )}
          >
            <div className="px-4 py-3 border-b border-stone-100 bg-white">
              <span className="text-sm font-medium text-stone-700">
                {label}{" "}
                <span className="text-stone-400 font-normal">({items.length})</span>
              </span>
            </div>
            <div className="p-2 space-y-2 overflow-y-auto max-h-[600px]">
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
