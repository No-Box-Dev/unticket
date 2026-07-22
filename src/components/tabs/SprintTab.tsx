import { useMemo, useState, useCallback, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
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
import { useSpecs } from "@/hooks/useSpecs";
import { useAuth } from "@/lib/auth";
import { withStatusTransition } from "@/lib/github-features";
import { useBoardStages } from "@/lib/board-stages";
import type { BoardStage, Feature, FeatureStatus, Spec } from "@/lib/types";
import { ArrowUpDown, Archive, LayoutGrid, Rocket, Search, Sparkles, Undo2 } from "lucide-react";
import { Spinner } from "@/components/Spinner";
import { PersonSelect } from "@/components/ui/PersonSelect";
import { AllMeToggle } from "@/components/ui/AllMeToggle";
import { cn } from "@/lib/cn";

type SortKey = "default" | "title";
type SprintView = "board" | "backlog";

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

  // Fetch every non-archived spec once and bucket by feature number so each
  // FeatureCard renders from a static prop instead of subscribing to its own
  // useSpecs observer. Cheaper on dense boards, and re-renders only when the
  // spec cache actually changes.
  const { data: allSpecs } = useSpecs({ featureNumber: "all" });
  const specsByFeature = useMemo(() => {
    const m = new Map<number, Spec[]>();
    for (const s of allSpecs ?? []) {
      if (s.archived) continue;
      if (s.featureNumber == null) continue;
      const list = m.get(s.featureNumber);
      if (list) list.push(s);
      else m.set(s.featureNumber, [s]);
    }
    // Sort each bucket newest-updated first so the card slice picks the
    // most relevant specs.
    for (const list of m.values()) {
      list.sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt));
    }
    return m;
  }, [allSpecs]);
  const EMPTY_SPECS: Spec[] = useMemo(() => [], []);
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
  const userLogin = user?.login.toLowerCase() ?? null;

  const [detailFeature, setDetailFeature] = useState<Feature | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>("title");
  const [selectedPersons, setSelectedPersons] = useState<string[]>(navFilter?.person ? [navFilter.person] : []);
  const [searchQuery, setSearchQuery] = useState("");

  // Board vs Backlog view is URL-synced so a bookmarked backlog stays put.
  const [searchParams, setSearchParams] = useSearchParams();
  const view: SprintView = searchParams.get("view") === "backlog" ? "backlog" : "board";
  const meOnly = searchParams.get("scope") === "me";
  const setMeOnly = useCallback(
    (me: boolean) => {
      const params = new URLSearchParams(searchParams);
      if (me) params.set("scope", "me");
      else params.delete("scope");
      params.delete("person");
      setSelectedPersons([]);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );
  const setView = useCallback(
    (next: SprintView) => {
      const params = new URLSearchParams(searchParams);
      if (next === "board") params.delete("view");
      else params.set("view", "backlog");
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const toggleBacklog = useCallback(
    (feature: Feature) => {
      const next: Feature = { ...feature, backlog: !feature.backlog };
      updateFeatureMut.mutate(next);
      if (detailFeature?.id === feature.id) setDetailFeature(next);
    },
    [updateFeatureMut, detailFeature],
  );

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

  const searchAndOwnerMatch = useCallback(
    (f: Feature) => {
      const q = searchQuery.toLowerCase().trim();
      if (meOnly && userLogin && !f.owners.some((o) => o.toLowerCase() === userLogin)) return false;
      if (selectedPersons.length > 0 && !f.owners.some((o) => selectedPersons.some((p) => o.toLowerCase() === p.toLowerCase()))) return false;
      if (q && !f.title.toLowerCase().includes(q) && !f.owners.some((o) => o.toLowerCase().includes(q))) return false;
      return true;
    },
    [selectedPersons, searchQuery, meOnly, userLogin],
  );

  // Board view drops backlogged features; backlog view shows only them.
  // Both share the same search + person filter so the toolbar behaves
  // identically across views.
  const filteredFeatures = useMemo(
    () => (features ?? []).filter((f) => !f.backlog && searchAndOwnerMatch(f)),
    [features, searchAndOwnerMatch],
  );

  const backlogFeatures = useMemo(
    () =>
      (features ?? [])
        .filter((f) => f.backlog && searchAndOwnerMatch(f))
        // Alphabetical by title (case-insensitive via localeCompare's
        // default) — backlog is a park-and-scan list, not a recency feed.
        .sort((a, b) => a.title.localeCompare(b.title)),
    [features, searchAndOwnerMatch],
  );

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
        view={view}
        onViewChange={setView}
        backlogCount={backlogFeatures.length}
        backlogFeatures={backlogFeatures}
        stages={stages}
        stageBuckets={stageBuckets}
        specsByFeature={specsByFeature}
        emptySpecs={EMPTY_SPECS}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        meOnly={meOnly}
        setMeOnly={setMeOnly}
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
        onToggleBacklog={toggleBacklog}
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
  view: SprintView;
  onViewChange: (v: SprintView) => void;
  backlogCount: number;
  backlogFeatures: Feature[];
  stages: BoardStage[];
  stageBuckets: Map<string, Feature[]>;
  /** Every non-archived spec bucketed by its owning feature number.
   * Cards read their slice out of this Map instead of subscribing to
   * their own useSpecs observer. */
  specsByFeature: Map<number, Spec[]>;
  emptySpecs: Spec[];
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  meOnly: boolean;
  setMeOnly: (me: boolean) => void;
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
  onToggleBacklog: (f: Feature) => void;
  isAdmin: boolean;
  onCleanDone: () => void;
  doneCount: number;
  cleanDonePending: boolean;
  cleanDoneTitle: string;
}

function FeaturesView({
  view, onViewChange, backlogCount, backlogFeatures,
  stages, stageBuckets, specsByFeature, emptySpecs,
  searchQuery, setSearchQuery, meOnly, setMeOnly, selectedPersons, setSelectedPersons,
  personPills, allPeopleNames,
  sortBy, setSortBy, dragOverCol, onDragStart, onDragOver, onDragLeave, onDrop,
  onUpdate, onDelete, onOpenDetail, onAdd, onToggleBacklog, isAdmin,
  onCleanDone, doneCount, cleanDonePending, cleanDoneTitle,
}: FeaturesViewProps) {
  return (
    <div className="space-y-2">
      {/* One-row toolbar: Add · Search · People · Sort · Clean done.
          Wraps on narrow screens via flex-wrap but everything stays inline
          on ~640px+ where the tab is mostly used. */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Board / Backlog toggle. Board is default; badge shows backlog
            count so nothing gets forgotten in there. */}
        <div className="flex rounded-lg border border-stone-200 overflow-hidden">
          <button
            onClick={() => onViewChange("board")}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors",
              view === "board"
                ? "bg-accent text-white"
                : "bg-white text-stone-600 hover:bg-stone-50",
            )}
          >
            <LayoutGrid size={12} /> Board
          </button>
          <button
            onClick={() => onViewChange("backlog")}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-l border-stone-200 cursor-pointer transition-colors",
              view === "backlog"
                ? "bg-accent text-white"
                : "bg-white text-stone-600 hover:bg-stone-50",
            )}
          >
            <Archive size={12} /> Backlog
            {backlogCount > 0 && view !== "backlog" && (
              <span className="text-[10px] text-stone-400 tabular-nums">
                {backlogCount}
              </span>
            )}
          </button>
        </div>

        <AllMeToggle me={meOnly} onChange={setMeOnly} />

        {view === "board" && <AddFeatureInput onAdd={onAdd} />}

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

        {view === "board" && isAdmin && (
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

      {view === "backlog" ? (
        <BacklogList
          features={backlogFeatures}
          stages={stages}
          onOpenDetail={onOpenDetail}
          onRestore={onToggleBacklog}
        />
      ) : (
        /* Kanban columns — fixed-width tracks so >4 stages scroll horizontally
           rather than squashing each card. */
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
                      ownSpecs={specsByFeature.get(feature.id) ?? emptySpecs}
                      onUpdate={onUpdate}
                      onDelete={onDelete}
                      onOpenDetail={onOpenDetail}
                      onSendToBacklog={onToggleBacklog}
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
      )}
    </div>
  );
}

// ─── Backlog view ──────────────────────────────────────────────────────

interface BacklogListProps {
  features: Feature[];
  stages: BoardStage[];
  onOpenDetail: (f: Feature) => void;
  onRestore: (f: Feature) => void;
}

function BacklogList({ features, stages, onOpenDetail, onRestore }: BacklogListProps) {
  const stageLookup = useMemo(() => {
    const m = new Map<string, BoardStage>();
    stages.forEach((s) => m.set(s.id, s));
    return m;
  }, [stages]);

  if (features.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-stone-200 bg-white/50 px-6 py-16 text-center text-sm text-stone-500">
        Nothing in the backlog. Send a feature here from the board when you want
        to park it out of sight without losing it.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
      <ul className="divide-y divide-stone-100">
        {features.map((f) => {
          const stage = stageLookup.get(f.status);
          return (
            <li
              key={f.id}
              className="flex items-center gap-3 px-4 py-2.5 hover:bg-stone-50 cursor-pointer"
              onClick={() => onOpenDetail(f)}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRestore(f);
                }}
                className="shrink-0 p-1.5 rounded-md border border-stone-200 text-stone-500 hover:text-accent hover:border-accent/40 cursor-pointer"
                title="Move back to board"
                aria-label={`Move ${f.title} back to board`}
              >
                <Undo2 size={12} />
              </button>
              <span className="flex-1 truncate text-sm text-stone-700">
                {f.title}
              </span>
              {stage && (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-stone-50 px-2 py-0.5 text-[10px] uppercase tracking-wider text-stone-500 border border-stone-200 shrink-0"
                  title={`Column when it left: ${stage.label}`}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: stage.color }}
                  />
                  {stage.label}
                </span>
              )}
              {f.owners.length > 0 && (
                <span className="text-[11px] text-stone-400 truncate max-w-[160px]">
                  {f.owners.join(", ")}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
