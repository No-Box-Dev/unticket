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
import { useBoardStages } from "@/lib/board-stages";
import type { BoardStage, Feature, FeatureStatus } from "@/lib/types";
import { ArrowUpDown, Rocket, Search, Sparkles } from "lucide-react";
import { Spinner } from "@/components/Spinner";
import { PersonSelect } from "@/components/ui/PersonSelect";
import { cn } from "@/lib/cn";

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

interface SprintTabProps {
  navFilter?: import("@/lib/types").NavFilter | null;
  urlFeatureId?: number;
  onUrlChange?: (featureId: number | null) => void;
}

export function SprintTab({ navFilter, urlFeatureId, onUrlChange }: SprintTabProps) {
  const { data: features, isLoading: featuresLoading } = useFeatures();
  const { data: people } = usePeople();
  const { data: orgMembers } = useActiveMembers();
  const stages = useBoardStages();
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
    // Display-name overrides from the People config — fall back to login when
    // no override exists. The set of options comes from org members so the
    // dropdown is always populated even when the config repo is empty.
    const nameByLogin = new Map((people ?? []).map((p) => [p.github, p.name || p.github]));
    const logins = Array.from(new Set((orgMembers ?? []).map((m) => m.login)));
    const pairs = logins.map((login) => ({ login, name: nameByLogin.get(login) ?? login }));
    pairs.sort((a, b) => {
      if (a.login === myLogin) return -1;
      if (b.login === myLogin) return 1;
      return a.login.localeCompare(b.login);
    });
    return pairs;
  }, [orgMembers, people, user]);

  const filteredFeatures = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return (features ?? []).filter((f) => {
      if (selectedPersons.length > 0 && !f.owners.some((o) => selectedPersons.some((p) => o.toLowerCase() === p.toLowerCase()))) return false;
      if (q && !f.title.toLowerCase().includes(q) && !f.owners.some((o) => o.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [features, selectedPersons, searchQuery]);

  // Bucket features into the configured stages. Features carrying a status not
  // in the current stage set (e.g. legacy `future` after the admin removed
  // that stage) hide from the board until they're moved — the admin save was
  // already blocked if any open feature was in a stage being removed, so this
  // case is normally impossible. Defensive in case D1 and config diverge.
  const stageBuckets = useMemo(() => {
    const validIds = new Set(stages.map((s) => s.id));
    const map = new Map<string, Feature[]>();
    for (const s of stages) map.set(s.id, []);
    for (const f of filteredFeatures) {
      if (!validIds.has(f.status)) continue;
      map.get(f.status)!.push(f);
    }
    for (const [id, list] of map) map.set(id, sortFeatures(list, sortBy));
    return map;
  }, [filteredFeatures, stages, sortBy]);

  // "Done" = features in the rightmost configured stage. That's the column
  // Clean Done targets, regardless of what the admin named it.
  const lastStage = stages[stages.length - 1];
  const doneCount = lastStage ? (stageBuckets.get(lastStage.id)?.length ?? 0) : 0;

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
    createFeatureMut.mutate({ title, status: stages[0]?.id ?? "todo" });
  };

  const handleCleanDone = async () => {
    if (doneCount === 0 || !lastStage) return;
    const ok = await confirm({
      title: `Clean ${doneCount} done feature${doneCount === 1 ? "" : "s"}?`,
      message: `Features in "${lastStage.label}" will be closed and removed from the board.`,
      variant: "danger",
      confirmLabel: "Clean",
    });
    if (ok) cleanDoneMut.mutate({ features: features ?? [], stageId: lastStage.id });
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
      <FeaturesView
        stages={stages}
        stageBuckets={stageBuckets}
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
        onCleanDone={handleCleanDone}
        doneCount={doneCount}
        cleanDonePending={cleanDoneMut.isPending}
        cleanDoneTitle={
          doneCount === 0
            ? `No features in ${lastStage?.label ?? "the last stage"} to clean`
            : `Clean ${doneCount} done feature${doneCount === 1 ? "" : "s"}`
        }
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
  stages: BoardStage[];
  stageBuckets: Map<string, Feature[]>;
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
  onCleanDone: () => void;
  doneCount: number;
  cleanDonePending: boolean;
  cleanDoneTitle: string;
}

function FeaturesView({
  stages, stageBuckets, searchQuery, setSearchQuery, selectedPersons, setSelectedPersons,
  personPills, allPeopleNames,
  sortBy, setSortBy, dragOverCol, onDragStart, onDragOver, onDragLeave, onDrop,
  onUpdate, onDelete, onOpenDetail, onAdd, isAdmin,
  onCleanDone, doneCount, cleanDonePending, cleanDoneTitle,
}: FeaturesViewProps) {
  return (
    <div className="space-y-2">
      {/* One-row toolbar: Add · Search · People · Sort · Clean done.
          Wraps on narrow screens via flex-wrap but everything stays inline
          on ~640px+ where the tab is mostly used. */}
      <div className="flex items-center gap-2 flex-wrap">
        <AddFeatureInput onAdd={onAdd} />

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

        {isAdmin && (
          <button
            onClick={onCleanDone}
            disabled={doneCount === 0 || cleanDonePending}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-stone-200 text-xs text-stone-500 hover:text-accent hover:border-accent/30 transition-colors cursor-pointer disabled:opacity-50 disabled:hover:text-stone-500 disabled:hover:border-stone-200"
            title={cleanDoneTitle}
          >
            <Sparkles size={12} />
            <span className="hidden sm:inline">
              {cleanDonePending ? "Cleaning..." : `Clean done${doneCount > 0 ? ` (${doneCount})` : ""}`}
            </span>
          </button>
        )}
      </div>

      {/* Kanban columns — fixed-width tracks so >4 stages scroll horizontally
          rather than squashing each card. */}
      <div className="overflow-x-auto -mx-4 sm:-mx-6 px-4 sm:px-6">
        <div className="flex gap-3 min-w-min">
          {stages.map((stage) => {
            const items = stageBuckets.get(stage.id) ?? [];
            return (
              <div
                key={stage.id}
                role="list"
                aria-label={`${stage.label} column`}
                onDragOver={(e) => onDragOver(e, stage.id)}
                onDragLeave={onDragLeave}
                onDrop={(e) => onDrop(e, stage.id)}
                className={cn(
                  "w-72 shrink-0 rounded-xl border border-stone-200 bg-stone-50 transition-colors",
                  dragOverCol === stage.id && "border-accent/50 bg-accent/5",
                )}
              >
                <div className="px-4 py-3 border-b border-stone-100 bg-white rounded-t-xl flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: stage.color }}
                  />
                  <span className="text-sm font-medium text-stone-700 truncate" title={stage.label}>
                    {stage.label}
                  </span>
                  <span className="text-xs text-stone-400 ml-auto">{items.length}</span>
                </div>
                <div className="p-2 pb-3 space-y-2 overflow-y-auto max-h-[calc(100vh-260px)]">
                  {items.map((feature) => (
                    <FeatureCard
                      key={feature.id}
                      feature={feature}
                      stages={stages}
                      allPeople={allPeopleNames}
                      onUpdate={onUpdate}
                      onDelete={onDelete}
                      onOpenDetail={onOpenDetail}
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
    </div>
  );
}
