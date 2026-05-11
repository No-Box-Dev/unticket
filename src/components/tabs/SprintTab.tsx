import { useMemo, useState, useCallback, useEffect } from "react";
import { ConfirmDialog, useConfirm } from "@/components/ui/ConfirmDialog";
import {
  useFeatures,
  usePeople,
  useCreateFeature,
  useUpdateFeature,
  useDeleteFeature,
  useCreateConfigRepo,
  useCleanDoneFeatures,
} from "@/hooks/useConfigRepo";
import { FeatureCard } from "@/components/sprint/FeatureCard";
import { FeatureDetailModal } from "@/components/sprint/FeatureDetailModal";
import { AddFeatureInput } from "@/components/sprint/AddFeatureInput";
import { useIsAdmin, useActiveMembers } from "@/hooks/useGitHub";
import { useAuth } from "@/lib/auth";
import { withStatusTransition } from "@/lib/github-features";
import type { Feature, FeatureStatus } from "@/lib/types";
import { ArrowUpDown, Rocket, Search, Sparkles } from "lucide-react";
import { Spinner } from "@/components/Spinner";
import { PersonSelect } from "@/components/ui/PersonSelect";
import { cn } from "@/lib/cn";

type SortKey = "default" | "title";

type BoardStatus = Exclude<FeatureStatus, "future">;
const COLUMN_DEFS: { status: BoardStatus; label: string; color: string }[] = [
  { status: "todo", label: "To do", color: "bg-status-plan" },
  { status: "staging", label: "Testing on staging", color: "bg-status-progress" },
  { status: "ready", label: "Ready for production", color: "bg-status-tested" },
  { status: "production", label: "On production", color: "bg-status-production" },
];

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

interface SprintTabProps {
  navFilter?: import("@/lib/types").NavFilter | null;
  urlFeatureId?: number;
  onUrlChange?: (featureId: number | null) => void;
}

export function SprintTab({ navFilter, urlFeatureId, onUrlChange }: SprintTabProps) {
  const { data: features, isLoading: featuresLoading } = useFeatures();
  const { data: people } = usePeople();
  const { data: orgMembers } = useActiveMembers();
  const createFeatureMut = useCreateFeature();
  const updateFeatureMut = useUpdateFeature();
  const deleteFeatureMut = useDeleteFeature();
  const createRepo = useCreateConfigRepo();
  const isAdmin = useIsAdmin();
  const { confirm, dialogProps } = useConfirm();
  const cleanDoneMut = useCleanDoneFeatures();
  const { user } = useAuth();

  const [detailFeature, setDetailFeature] = useState<Feature | null>(null);

  // Open/close feature from URL
  useEffect(() => {
    if (!features) return;
    if (urlFeatureId) {
      if (detailFeature?.id !== urlFeatureId) {
        const f = features.find((feat) => feat.id === urlFeatureId);
        // eslint-disable-next-line react-hooks/set-state-in-effect
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
  const [selectedPersons, setSelectedPersons] = useState<string[]>(navFilter?.person ? [navFilter.person] : []);
  const [searchQuery, setSearchQuery] = useState("");

  const allPeopleNames = useMemo(
    () => (orgMembers ?? []).map((m) => m.login),
    [orgMembers],
  );

  const personPills = useMemo(() => {
    const myLogin = user?.login;
    const names = (people ?? []).map((p) => p.name || p.github);
    const logins = (people ?? []).map((p) => p.github);
    const pairs = logins.map((login, i) => ({ login, name: names[i] }));
    pairs.sort((a, b) => {
      if (a.login === myLogin) return -1;
      if (b.login === myLogin) return 1;
      return a.name.localeCompare(b.name);
    });
    return pairs;
  }, [people, user]);

  // Active features (everything except backlog/future)
  const activeFeatures = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return (features ?? []).filter((f) => {
      if (f.status === "future") return false;
      if (selectedPersons.length > 0 && !f.owners.some((o) => selectedPersons.some((p) => o.toLowerCase() === p.toLowerCase()))) return false;
      if (q && !f.title.toLowerCase().includes(q) && !f.owners.some((o) => o.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [features, selectedPersons, searchQuery]);

  const sortedColumns = useMemo(() => ({
    todo: sortFeatures(activeFeatures.filter((f) => f.status === "todo"), sortBy),
    staging: sortFeatures(activeFeatures.filter((f) => f.status === "staging"), sortBy),
    ready: sortFeatures(activeFeatures.filter((f) => f.status === "ready"), sortBy),
    production: sortFeatures(activeFeatures.filter((f) => f.status === "production"), sortBy),
  }), [activeFeatures, sortBy]);

  const doneCount = sortedColumns.production.length;

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
    if (detailFeature?.id === featureId) setDetailFeature(updated);
  }, [features, updateFeatureMut, detailFeature]);

  const handleDragOver = useCallback((e: React.DragEvent, status: FeatureStatus) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverCol(status);
  }, []);

  const handleDragLeave = useCallback(() => { setDragOverCol(null); }, []);

  const updateFeature = (updated: Feature) => {
    updateFeatureMut.mutate(updated);
    if (detailFeature?.id === updated.id) setDetailFeature(updated);
  };

  const deleteFeature = async (id: number) => {
    const ok = await confirm({ title: "Remove this feature?", message: "It will be closed and removed from the board.", variant: "danger", confirmLabel: "Remove" });
    if (ok) deleteFeatureMut.mutate(id);
  };

  const addFeature = (title: string) => {
    createFeatureMut.mutate({ title, status: "todo" });
  };

  const handleCleanDone = async () => {
    if (doneCount === 0) return;
    const ok = await confirm({
      title: `Clean ${doneCount} done feature${doneCount === 1 ? "" : "s"}?`,
      message: "Their GitHub issues will be closed and they'll disappear from the board.",
      variant: "danger",
      confirmLabel: "Clean",
    });
    if (ok) cleanDoneMut.mutate(features ?? []);
  };

  if (featuresLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!features) {
    return (
      <div className="text-center py-16">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-accent/10 mb-4">
          <Rocket className="w-7 h-7 text-accent" />
        </div>
        <h3 className="text-lg font-semibold text-stone-700 mb-1">Set up unticket.ai</h3>
        <p className="text-sm text-stone-400 mb-6 max-w-sm mx-auto">
          Initialise the workspace to start tracking features.
        </p>
        <button
          onClick={() => createRepo.mutate()}
          disabled={createRepo.isPending}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-accent text-white text-sm font-medium rounded-lg hover:bg-accent/90 transition-colors disabled:opacity-50 cursor-pointer"
        >
          {createRepo.isPending ? "Setting up..." : "Set Up unticket.ai"}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-8">
      {/* Header: actions */}
      <div className="flex items-center justify-end flex-wrap gap-2">
        {isAdmin && (
          <button
            onClick={handleCleanDone}
            disabled={doneCount === 0 || cleanDoneMut.isPending}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-stone-200 text-xs text-stone-500 hover:text-accent hover:border-accent/30 transition-colors cursor-pointer disabled:opacity-50 disabled:hover:text-stone-500 disabled:hover:border-stone-200"
            title={doneCount === 0 ? "No features in production to clean" : `Clean ${doneCount} done feature${doneCount === 1 ? "" : "s"}`}
          >
            <Sparkles size={12} />
            <span className="hidden sm:inline">
              {cleanDoneMut.isPending ? "Cleaning..." : `Clean done${doneCount > 0 ? ` (${doneCount})` : ""}`}
            </span>
          </button>
        )}
      </div>

      <FeaturesView
        sortedColumns={sortedColumns}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        selectedPersons={selectedPersons}
        setSelectedPersons={setSelectedPersons}
        personPills={personPills}
        allPeopleNames={allPeopleNames}
        sortBy={sortBy}
        setSortBy={setSortBy}
        dragOverCol={dragOverCol}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onUpdate={updateFeature}
        onDelete={deleteFeature}
        onOpenDetail={openDetail}
        onAdd={addFeature}
        isAdmin={isAdmin}
      />

      {detailFeature && (
        <FeatureDetailModal
          key={detailFeature.id}
          feature={detailFeature}
          allPeople={allPeopleNames}
          onClose={closeDetail}
          onUpdate={updateFeature}
        />
      )}
      <ConfirmDialog {...dialogProps} />
    </div>
  );
}

// ─── Features (Kanban) View ────────────────────────────────────────────

interface FeaturesViewProps {
  sortedColumns: Record<BoardStatus, Feature[]>;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  selectedPersons: string[];
  setSelectedPersons: (p: string[]) => void;
  personPills: { login: string; name: string }[];
  allPeopleNames: string[];
  sortBy: SortKey;
  setSortBy: (k: SortKey) => void;
  dragOverCol: FeatureStatus | null;
  onDragStart: (e: React.DragEvent, f: Feature) => void;
  onDragOver: (e: React.DragEvent, s: FeatureStatus) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, s: FeatureStatus) => void;
  onUpdate: (f: Feature) => void;
  onDelete: (id: number) => void;
  onOpenDetail: (f: Feature) => void;
  onAdd: (title: string) => void;
  isAdmin: boolean;
}

function FeaturesView({
  sortedColumns, searchQuery, setSearchQuery, selectedPersons, setSelectedPersons,
  personPills, allPeopleNames,
  sortBy, setSortBy, dragOverCol, onDragStart, onDragOver, onDragLeave, onDrop,
  onUpdate, onDelete, onOpenDetail, onAdd, isAdmin,
}: FeaturesViewProps) {
  return (
    <div className="space-y-2">
      <AddFeatureInput onAdd={onAdd} />

      {/* Search + filters row */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search features..."
            className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-stone-200 bg-white text-sm text-stone-700 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </div>

        <PersonSelect value={selectedPersons.length > 0 ? selectedPersons : null} onChange={(v) => setSelectedPersons(Array.isArray(v) ? v : v ? [v] : [])} placeholder="All people" multi
          options={personPills.map((p) => ({ value: p.login, label: p.name }))} />

        <div className="flex items-center gap-1">
          <ArrowUpDown size={13} className="text-stone-400" />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            className="px-2 py-1.5 rounded-lg border border-stone-200 bg-white text-xs text-stone-500 focus:outline-none focus:border-accent cursor-pointer"
          >
            <option value="default">Default</option>
            <option value="title">Title A-Z</option>
          </select>
        </div>
      </div>

      {/* Kanban columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {COLUMN_DEFS.map((col) => {
          const items = sortedColumns[col.status];
          return (
            <div
              key={col.status}
              role="list"
              aria-label={`${col.label} column`}
              onDragOver={(e) => onDragOver(e, col.status)}
              onDragLeave={onDragLeave}
              onDrop={(e) => onDrop(e, col.status)}
              className={cn(
                "rounded-xl border border-stone-200  bg-stone-50  transition-colors",
                dragOverCol === col.status && "border-accent/50 bg-accent/5",
              )}
            >
              <div className="px-4 py-3 border-b border-stone-100 bg-white rounded-t-xl flex items-center gap-2">
                <span className={cn("w-2.5 h-2.5 rounded-full", col.color)} />
                <span className="text-sm font-medium text-stone-700">
                  {col.label}
                </span>
                <span className="text-xs text-stone-400 ml-auto">{items.length}</span>
              </div>
              <div className="p-2 pb-3 space-y-2 overflow-y-auto max-h-[calc(100vh-260px)]">
                {items.map((feature) => (
                  <FeatureCard
                    key={feature.id}
                    feature={feature}
                    allPeople={allPeopleNames}
                    onUpdate={onUpdate}
                    onDelete={onDelete}
                    onOpenDetail={onOpenDetail}
                    mode="active"
                    isAdmin={isAdmin}
                    draggable
                    onDragStart={onDragStart}
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
  );
}
