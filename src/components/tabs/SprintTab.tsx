import { useMemo, useState, useCallback } from "react";
import { useSprint, useFeatures, usePeople, useCreateFeature, useUpdateFeature, useDeleteFeature, useCreateConfigRepo, useLegacyFeatures, useMigrateFeatures, useAdvanceSprint, useSprintSnapshots, useSaveSprintSnapshots, useSyncFeatures } from "@/hooks/useConfigRepo";
import { FeatureCard } from "@/components/sprint/FeatureCard";
import { FeatureDetailModal } from "@/components/sprint/FeatureDetailModal";
import { NewSprintModal } from "@/components/sprint/NewSprintModal";
import { AddFeatureInput } from "@/components/sprint/AddFeatureInput";
import { useIsAdmin, useMergedPRs, useClosedIssues, useAllIssues } from "@/hooks/useGitHub";
import { withStatusTransition } from "@/lib/github-features";
import type { Feature, FeatureStatus, SprintSnapshot } from "@/lib/types";
import { Calendar, Rocket, ArrowUpDown, Upload, Loader2, FastForward, RefreshCw } from "lucide-react";
import { Spinner } from "@/components/Spinner";
import { cn } from "@/lib/cn";

type SortKey = "default" | "priority" | "effort" | "title";

const COLUMN_DEFS: { status: "plan" | "demo" | "production"; label: string }[] = [
  { status: "plan", label: "Plan" },
  { status: "demo", label: "Demo" },
  { status: "production", label: "Production" },
];

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

export function SprintTab({ repoNames }: SprintTabProps) {
  const { data: sprint, isLoading: sprintLoading } = useSprint();
  const { data: features } = useFeatures();
  const { data: people } = usePeople();
  const createFeatureMut = useCreateFeature();
  const updateFeatureMut = useUpdateFeature();
  const deleteFeatureMut = useDeleteFeature();
  const createRepo = useCreateConfigRepo();
  const { data: legacyFeatures } = useLegacyFeatures();
  const migrateMut = useMigrateFeatures();
  const isAdmin = useIsAdmin();
  const advanceSprintMut = useAdvanceSprint();
  const { data: snapshots } = useSprintSnapshots();
  const saveSnapshotsMut = useSaveSprintSnapshots();
  const syncFeaturesMut = useSyncFeatures();
  const { data: mergedPRs } = useMergedPRs(repoNames);
  const { data: closedIssues } = useClosedIssues(repoNames);
  const { data: allIssues } = useAllIssues(repoNames);

  const [detailFeature, setDetailFeature] = useState<Feature | null>(null);
  const [showNewSprint, setShowNewSprint] = useState(false);
  const [advanceFailedCount, setAdvanceFailedCount] = useState(0);
  const [sortBy, setSortBy] = useState<SortKey>("title");
  const [migrateProgress, setMigrateProgress] = useState<{ done: number; total: number } | null>(null);
  const [migrateDismissed, setMigrateDismissed] = useState(false);
  const [viewingSnapshot, setViewingSnapshot] = useState<number | null>(null);
  const [showBackfill, setShowBackfill] = useState(false);
  const [backfillNumber, setBackfillNumber] = useState(1);
  const [backfillName, setBackfillName] = useState("");
  const [backfillStart, setBackfillStart] = useState("");
  const [backfillEnd, setBackfillEnd] = useState("");
  const [backfillFocus, setBackfillFocus] = useState("");

  const activeSnapshot = viewingSnapshot !== null
    ? (snapshots ?? []).find((s) => s.sprintNumber === viewingSnapshot) ?? null
    : null;

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
    e.dataTransfer.setData("text/plain", String(feature.id));
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetStatus: FeatureStatus) => {
    e.preventDefault();
    setDragOverCol(null);
    const featureId = parseInt(e.dataTransfer.getData("text/plain"));
    const feature = (features ?? []).find((f) => f.id === featureId);
    if (!feature || feature.status === targetStatus) return;
    const updated = withStatusTransition(feature, targetStatus);
    updateFeatureMut.mutate(updated);
    if (detailFeature?.id === featureId) {
      setDetailFeature(updated);
    }
  }, [features, updateFeatureMut, detailFeature]);

  const handleDragOver = useCallback((e: React.DragEvent, status: FeatureStatus) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverCol(status);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverCol(null);
  }, []);

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
      status: "plan",
      sprint: sprint?.number ?? null,
      effort: "medium",
    });
  };

  if (sprintLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" />
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
          {createRepo.isPending ? "Setting up..." : "Set Up unticket.ai"}
        </button>
        {createRepo.isError && (
          <p className="text-sm text-red-500 mt-3">
            {(createRepo.error as any)?.message ?? "Failed to create config repo"}
          </p>
        )}
      </div>
    );
  }

  const showMigrationBanner = !migrateDismissed
    && !migrateMut.isSuccess
    && (legacyFeatures?.length ?? 0) > 0
    && (features?.length ?? 0) === 0;

  return (
    <div className="space-y-4 pb-8">
      {/* Migration banner */}
      {showMigrationBanner && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-3">
          <Upload size={16} className="text-amber-600 shrink-0" />
          <div className="flex-1">
            <p className="text-sm text-amber-800">
              {migrateProgress
                ? `Migrating features... (${migrateProgress.done}/${migrateProgress.total})`
                : `${legacyFeatures!.length} feature${legacyFeatures!.length === 1 ? "" : "s"} found in D1. Migrate to GitHub Issues?`}
            </p>
          </div>
          {!migrateMut.isPending && (
            <button
              onClick={() => {
                migrateMut.mutate({
                  legacy: legacyFeatures!,
                  onProgress: (done, total) => setMigrateProgress({ done, total }),
                });
              }}
              className="px-3 py-1.5 rounded-md bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 cursor-pointer flex items-center gap-1.5"
            >
              <Upload size={12} />
              Migrate
            </button>
          )}
          {migrateMut.isPending && (
            <Loader2 size={16} className="text-amber-600 animate-spin" />
          )}
          {!migrateMut.isPending && (
            <button
              onClick={() => setMigrateDismissed(true)}
              className="text-amber-400 hover:text-amber-600 text-xs cursor-pointer"
            >
              Dismiss
            </button>
          )}
        </div>
      )}

    {/* Sprint selector */}
    {snapshots && snapshots.length > 0 && (
      <div className="flex items-center gap-2 flex-wrap">
        {[...(snapshots ?? [])].sort((a, b) => a.sprintNumber - b.sprintNumber).map((snap) => (
          <button
            key={snap.sprintNumber}
            onClick={() => setViewingSnapshot(viewingSnapshot === snap.sprintNumber ? null : snap.sprintNumber)}
            className={cn(
              "px-3 py-1.5 text-xs font-medium rounded-full cursor-pointer transition-colors",
              viewingSnapshot === snap.sprintNumber
                ? "bg-stone-800 text-white"
                : "bg-stone-100 text-stone-500 hover:bg-stone-200",
            )}
          >
            Sprint {snap.sprintNumber}
          </button>
        ))}
        <button
          onClick={() => setViewingSnapshot(null)}
          className={cn(
            "px-3 py-1.5 text-xs font-medium rounded-full cursor-pointer transition-colors",
            viewingSnapshot === null
              ? "bg-brand text-white"
              : "bg-stone-100 text-stone-500 hover:bg-stone-200",
          )}
        >
          Sprint {sprint.number} <span className="text-[10px] opacity-70">(current)</span>
        </button>
        {isAdmin && (
          <button
            onClick={() => setShowBackfill(!showBackfill)}
            className="px-2 py-1.5 text-xs text-stone-400 hover:text-brand cursor-pointer"
          >
            +
          </button>
        )}
      </div>
    )}

    {/* Backfill form */}
    {isAdmin && showBackfill && (
      <div className="bg-white rounded-xl border border-stone-200 p-4 space-y-3">
        <h4 className="text-sm font-semibold text-stone-800">Backfill Sprint Snapshot</h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-stone-500 block mb-1">Sprint #</label>
            <input type="number" min={1} value={backfillNumber} onChange={(e) => setBackfillNumber(parseInt(e.target.value) || 1)}
              className="w-full px-3 py-2 rounded-md border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30" />
          </div>
          <div>
            <label className="text-xs text-stone-500 block mb-1">Name</label>
            <input type="text" value={backfillName} onChange={(e) => setBackfillName(e.target.value)} placeholder="Sprint name..."
              className="w-full px-3 py-2 rounded-md border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30" />
          </div>
          <div>
            <label className="text-xs text-stone-500 block mb-1">Start Date</label>
            <input type="date" value={backfillStart} onChange={(e) => setBackfillStart(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30" />
          </div>
          <div>
            <label className="text-xs text-stone-500 block mb-1">End Date</label>
            <input type="date" value={backfillEnd} onChange={(e) => setBackfillEnd(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30" />
          </div>
        </div>
        <div>
          <label className="text-xs text-stone-500 block mb-1">Focus</label>
          <input type="text" value={backfillFocus} onChange={(e) => setBackfillFocus(e.target.value)} placeholder="Sprint focus..."
            className="w-full px-3 py-2 rounded-md border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30" />
        </div>
        <div className="flex items-center gap-2">
          <button
            disabled={!backfillStart || !backfillEnd || saveSnapshotsMut.isPending}
            onClick={() => {
              const inRange = (dateStr: string) => dateStr >= backfillStart && dateStr <= backfillEnd + "T23:59:59";
              const bf = (features ?? []).filter((f) => f.sprint === backfillNumber);
              const snap: SprintSnapshot = {
                sprintNumber: backfillNumber, name: backfillName, startDate: backfillStart, endDate: backfillEnd, focus: backfillFocus,
                metrics: {
                  prsMerged: (mergedPRs ?? []).filter((pr: any) => pr.merged_at && inRange(pr.merged_at)).length,
                  issuesCreated: (allIssues ?? []).filter((i: any) => inRange(i.created_at)).length,
                  issuesClosed: (closedIssues ?? []).filter((i: any) => i.closed_at && inRange(i.closed_at)).length,
                  featuresCompleted: bf.filter((f) => f.status === "production").length,
                  featuresCarriedOver: bf.filter((f) => f.status === "plan" || f.status === "demo").length,
                },
                features: bf.map((f) => ({ title: f.title, status: f.status, owners: f.owners })),
                createdAt: new Date().toISOString(),
              };
              const existing = (snapshots ?? []).filter((s) => s.sprintNumber !== backfillNumber);
              saveSnapshotsMut.mutate([...existing, snap], { onSuccess: () => { setShowBackfill(false); setBackfillName(""); setBackfillStart(""); setBackfillEnd(""); setBackfillFocus(""); } });
            }}
            className="px-4 py-2 bg-brand text-white text-sm font-medium rounded-lg hover:bg-brand/90 disabled:opacity-50 cursor-pointer"
          >
            {saveSnapshotsMut.isPending ? "Saving..." : "Create Snapshot"}
          </button>
          <button onClick={() => setShowBackfill(false)} className="px-4 py-2 border border-stone-200 text-sm text-stone-600 rounded-lg hover:bg-stone-50 cursor-pointer">Cancel</button>
        </div>
      </div>
    )}

    {/* Past sprint snapshot view */}
    {activeSnapshot && (
      <SnapshotView snapshot={activeSnapshot} />
    )}

    {/* Current sprint board */}
    {!activeSnapshot && (
    <div className="flex gap-4">
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
        <button
          onClick={() => syncFeaturesMut.mutate()}
          disabled={syncFeaturesMut.isPending}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-stone-200 text-xs text-stone-500 hover:text-brand hover:border-brand/30 transition-colors cursor-pointer w-full"
        >
          <RefreshCw size={13} className={syncFeaturesMut.isPending ? "animate-spin" : ""} />
          {syncFeaturesMut.isPending ? "Syncing..." : "Sync Features"}
        </button>
        <button
          onClick={() => setShowNewSprint(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-stone-200 text-xs text-stone-500 hover:text-brand hover:border-brand/30 transition-colors cursor-pointer w-full"
        >
          <FastForward size={13} />
          New Sprint
        </button>
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
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <AddFeatureInput onAdd={addFeature} />
          </div>
          <button
            onClick={() => syncFeaturesMut.mutate()}
            disabled={syncFeaturesMut.isPending}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-stone-200 text-xs text-stone-500 hover:text-brand hover:border-brand/30 transition-colors cursor-pointer shrink-0"
          >
            <RefreshCw size={13} className={syncFeaturesMut.isPending ? "animate-spin" : ""} />
          </button>
          <button
            onClick={() => setShowNewSprint(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-stone-200 text-xs text-stone-500 hover:text-brand hover:border-brand/30 transition-colors cursor-pointer shrink-0"
          >
            <FastForward size={13} />
            New Sprint
          </button>
        </div>
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
        {COLUMN_DEFS.map((col) => {
          const items = sortedColumns[col.status];
          return (
          <div
            key={col.status}
            onDragOver={(e) => handleDragOver(e, col.status)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, col.status)}
            className={cn(
              "rounded-xl border border-stone-200 bg-stone-50 transition-colors",
              dragOverCol === col.status && "border-brand/50 bg-brand/5",
            )}
          >
            <div className="px-4 py-3 border-b border-stone-100 bg-white rounded-t-xl">
              <span className="text-sm font-medium text-stone-700">
                {col.label}{" "}
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
                  isAdmin={isAdmin}
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
          );
        })}
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

      {/* New Sprint modal */}
      {showNewSprint && (
        <NewSprintModal
          currentSprint={sprint}
          features={features ?? []}
          isPending={advanceSprintMut.isPending}
          failedCount={advanceFailedCount}
          onClose={() => { setShowNewSprint(false); setAdvanceFailedCount(0); }}
          onConfirm={(newSprint) => {
            setAdvanceFailedCount(0);
            const sf = (features ?? []).filter((f) => f.sprint === sprint.number && f.status !== "future");
            const inRange = (dateStr: string) => dateStr >= sprint.startDate && dateStr <= sprint.endDate + "T23:59:59";
            const snapshot: Omit<SprintSnapshot, "createdAt"> = {
              sprintNumber: sprint.number, name: sprint.name, startDate: sprint.startDate, endDate: sprint.endDate, focus: sprint.focus,
              metrics: {
                prsMerged: (mergedPRs ?? []).filter((pr: any) => pr.merged_at && inRange(pr.merged_at)).length,
                issuesCreated: (allIssues ?? []).filter((i: any) => inRange(i.created_at)).length,
                issuesClosed: (closedIssues ?? []).filter((i: any) => i.closed_at && inRange(i.closed_at)).length,
                featuresCompleted: sf.filter((f) => f.status === "production").length,
                featuresCarriedOver: sf.filter((f) => f.status === "plan" || f.status === "demo").length,
              },
              features: sf.map((f) => ({ title: f.title, status: f.status, owners: f.owners })),
            };
            advanceSprintMut.mutate(
              { newSprint, oldSprintNumber: sprint.number, features: features ?? [], snapshot },
              { onSuccess: (result) => { if (result.failed.length === 0) setShowNewSprint(false); else setAdvanceFailedCount(result.failed.length); } },
            );
          }}
        />
      )}
    </div>
    )}
    </div>
  );
}

function SnapshotView({ snapshot }: { snapshot: SprintSnapshot }) {
  const { metrics, features: snapshotFeatures } = snapshot;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold text-stone-800">
          Sprint {snapshot.sprintNumber}
          {snapshot.name && <span className="text-stone-400 font-normal ml-2">— {snapshot.name}</span>}
        </h2>
        <span className="text-xs text-stone-400">
          {formatDate(snapshot.startDate)} – {formatDate(snapshot.endDate)}
        </span>
      </div>

      {snapshot.focus && (
        <p className="text-sm text-brand">{snapshot.focus}</p>
      )}

      {/* Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {([
          ["PRs Merged", metrics.prsMerged],
          ["Issues Created", metrics.issuesCreated],
          ["Issues Closed", metrics.issuesClosed],
          ["Features Shipped", metrics.featuresCompleted],
          ["Carried Over", metrics.featuresCarriedOver],
        ] as const).map(([label, value]) => (
          <div key={label} className="bg-white rounded-xl border border-stone-200 px-4 py-3 text-center">
            <div className="text-2xl font-semibold text-stone-800">{value}</div>
            <div className="text-[10px] text-stone-400 uppercase tracking-wider mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Features */}
      {snapshotFeatures.length > 0 && (
        <div className="bg-white rounded-xl border border-stone-200 p-4">
          <h3 className="text-xs font-medium text-stone-400 uppercase tracking-wider mb-3">Features</h3>
          <div className="space-y-2">
            {snapshotFeatures.map((f, i) => (
              <div key={i} className="flex items-center gap-2.5">
                <span className={cn(
                  "w-2.5 h-2.5 rounded-full shrink-0",
                  f.status === "production" ? "bg-green-500" : f.status === "demo" ? "bg-amber-500" : "bg-stone-300",
                )} />
                <span className="text-sm text-stone-700">{f.title}</span>
                {f.owners.length > 0 && (
                  <span className="text-xs text-stone-400 ml-auto shrink-0">{f.owners.join(", ")}</span>
                )}
              </div>
            ))}
          </div>
        </div>
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
