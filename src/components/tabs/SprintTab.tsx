/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState, useCallback, useEffect } from "react";
import { ConfirmDialog, useConfirm } from "@/components/ui/ConfirmDialog";
import { useSprint, useFeatures, usePeople, useCreateFeature, useUpdateFeature, useDeleteFeature, useCreateConfigRepo, useAdvanceSprint, useRevertSprint, useSprintSnapshots, useSaveSprintSnapshots, useSaveSprint, useSyncFeatures } from "@/hooks/useConfigRepo";
import { FeatureCard } from "@/components/sprint/FeatureCard";
import { FeatureDetailModal } from "@/components/sprint/FeatureDetailModal";
import { NewSprintModal } from "@/components/sprint/NewSprintModal";
import { AddFeatureInput } from "@/components/sprint/AddFeatureInput";
import { useIsAdmin, useMergedPRs, useClosedIssues, useAllIssues, useActiveMembers } from "@/hooks/useGitHub";
import { useAuth } from "@/lib/auth";
import { useSidebar } from "@/lib/sidebar";
import { withStatusTransition } from "@/lib/github-features";
import type { Feature, FeatureStatus, SprintSnapshot } from "@/lib/types";
import { Calendar, Rocket, ArrowUpDown, Loader2, Lock, Undo2, Play, RefreshCw, Search, ChevronDown } from "lucide-react";
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
  repoNames: string[];
  navFilter?: import("@/lib/types").NavFilter | null;
  urlFeatureId?: number;
  urlSprintNum?: number;
  onUrlChange?: (featureId: number | null, sprintNum: number | null) => void;
}

export function SprintTab({ repoNames, navFilter, urlFeatureId, urlSprintNum, onUrlChange }: SprintTabProps) {
  const { data: sprint, isLoading: sprintLoading } = useSprint();
  const { data: features } = useFeatures();
  const { data: people } = usePeople();
  const { data: orgMembers } = useActiveMembers();
  const createFeatureMut = useCreateFeature();
  const updateFeatureMut = useUpdateFeature();
  const deleteFeatureMut = useDeleteFeature();
  const createRepo = useCreateConfigRepo();
  const isAdmin = useIsAdmin();
  const advanceSprintMut = useAdvanceSprint();
  const revertSprintMut = useRevertSprint();
  const { data: snapshots } = useSprintSnapshots();
  const { confirm, dialogProps } = useConfirm();
  const saveSnapshotsMut = useSaveSprintSnapshots();
  const saveSprintMut = useSaveSprint();
  const syncFeaturesMut = useSyncFeatures();
  const { user } = useAuth();
  const { data: mergedPRs } = useMergedPRs(repoNames);
  const { data: closedIssues } = useClosedIssues(repoNames);
  const { data: allIssues } = useAllIssues(repoNames);
  const { viewingSprint, setViewingSprint } = useSidebar();

  const [detailFeature, setDetailFeature] = useState<Feature | null>(null);

  // Sync sprint from URL (only when URL explicitly has a sprint param)
  useEffect(() => {
    if (urlSprintNum != null) {
      if (sprint && urlSprintNum !== sprint.number) {
        setViewingSprint(urlSprintNum);
      } else if (sprint && urlSprintNum === sprint.number) {
        setViewingSprint(null); // URL points to current sprint, reset
      }
    }
  }, [urlSprintNum, sprint, setViewingSprint]);

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
    onUrlChange?.(f.id, viewingSprint ?? sprint?.number ?? null);
  }, [onUrlChange, viewingSprint, sprint]);

  const closeDetail = useCallback(() => {
    setDetailFeature(null);
    onUrlChange?.(null, viewingSprint ?? sprint?.number ?? null);
  }, [onUrlChange, viewingSprint, sprint]);
  const [showNewSprint, setShowNewSprint] = useState(false);
  const [advanceFailedCount, setAdvanceFailedCount] = useState(0);
  const [sortBy, setSortBy] = useState<SortKey>("title");
  const [selectedPersons, setSelectedPersons] = useState<string[]>(navFilter?.person ? [navFilter.person] : []);
  const [searchQuery, setSearchQuery] = useState("");
  const [showBackfill, setShowBackfill] = useState(false);
  const [backfillNumber, setBackfillNumber] = useState(1);
  const [backfillName, setBackfillName] = useState("");
  const [backfillStart, setBackfillStart] = useState("");
  const [backfillEnd, setBackfillEnd] = useState("");
  const [backfillFocus, setBackfillFocus] = useState("");

  const sortedSnapshots = useMemo(
    () => [...(snapshots ?? [])].sort((a, b) => b.sprintNumber - a.sprintNumber),
    [snapshots],
  );

  // Detect future sprint numbers from features (sprints ahead of current)
  const futureSprints = useMemo(() => {
    if (!features || !sprint) return [];
    const snapshotNums = new Set((snapshots ?? []).map((s) => s.sprintNumber));
    const nums = new Set<number>();
    for (const f of features) {
      if (f.sprint !== null && f.sprint > sprint.number && !snapshotNums.has(f.sprint)) {
        nums.add(f.sprint);
      }
    }
    return [...nums].sort((a, b) => a - b);
  }, [features, sprint, snapshots]);

  // Determine what we're viewing: null = current sprint, number = snapshot or future
  const activeSnapshot = viewingSprint !== null
    ? sortedSnapshots.find((s) => s.sprintNumber === viewingSprint) ?? null
    : null;

  const isViewingFutureSprint =
    viewingSprint !== null && !activeSnapshot && futureSprints.includes(viewingSprint);
  const viewingFutureSprint = isViewingFutureSprint ? viewingSprint : null;

  // The effective sprint number for feature filtering
  const effectiveSprintNumber = viewingFutureSprint ?? sprint?.number ?? 0;

  const allPeopleNames = useMemo(
    () => (orgMembers ?? []).map((m) => m.login),
    [orgMembers],
  );

  const sprintOptions = useMemo(() => {
    const opts: { value: number | null; label: string }[] = [];
    if (sprint) opts.push({ value: sprint.number, label: `Sprint ${sprint.number}` });
    for (const num of futureSprints) {
      opts.push({ value: num, label: `Sprint ${num} (upcoming)` });
    }
    // Allow moving to a new future sprint (current + 1 if not already listed)
    const nextNum = (sprint?.number ?? 0) + 1;
    if (!opts.some((o) => o.value === nextNum)) {
      opts.push({ value: nextNum, label: `Sprint ${nextNum} (new)` });
    }
    opts.push({ value: null, label: "Backlog" });
    return opts;
  }, [sprint, futureSprints]);

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

  // Filtered sprint features
  const sprintFeatures = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return (features ?? []).filter((f) => {
      if (f.sprint !== effectiveSprintNumber || f.status === "future") return false;
      if (selectedPersons.length > 0 && !f.owners.some((o) => selectedPersons.some((p) => o.toLowerCase() === p.toLowerCase()))) return false;
      if (q && !f.title.toLowerCase().includes(q) && !f.owners.some((o) => o.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [features, effectiveSprintNumber, selectedPersons, searchQuery]);

  const sortedColumns = useMemo(() => ({
    todo: sortFeatures(sprintFeatures.filter((f) => f.status === "todo"), sortBy),
    staging: sortFeatures(sprintFeatures.filter((f) => f.status === "staging"), sortBy),
    ready: sortFeatures(sprintFeatures.filter((f) => f.status === "ready"), sortBy),
    production: sortFeatures(sprintFeatures.filter((f) => f.status === "production"), sortBy),
  }), [sprintFeatures, sortBy]);

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
    const ok = await confirm({ title: "Remove this feature?", message: "It will be downgraded to a regular issue.", variant: "danger", confirmLabel: "Remove" });
    if (ok) deleteFeatureMut.mutate(id);
  };

  const addFeature = (title: string) => {
    createFeatureMut.mutate({ title, status: "todo", sprint: sprint?.number ?? null });
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
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-accent/10 mb-4">
          <Rocket className="w-7 h-7 text-accent" />
        </div>
        <h3 className="text-lg font-semibold text-stone-700 mb-1">No sprint configured yet</h3>
        <p className="text-sm text-stone-400 mb-6 max-w-sm mx-auto">
          Create a <code className="bg-stone-100 px-1 rounded">unticket</code> config repo to start tracking sprints, features, and your team.
        </p>
        <button
          onClick={() => createRepo.mutate()}
          disabled={createRepo.isPending}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-accent text-white text-sm font-medium rounded-lg hover:bg-accent/90 transition-colors disabled:opacity-50 cursor-pointer"
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

  return (
    <div className="space-y-4 pb-8">
      {/* Sprint header bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          {/* Sprint selector */}
          <div className="relative">
            <select
              value={viewingSprint ?? "current"}
              onChange={(e) => {
                const val = e.target.value;
                const num = val === "current" ? null : Number(val);
                setViewingSprint(num);
                onUrlChange?.(null, num ?? sprint?.number ?? null);
              }}
              className="appearance-none pl-2.5 pr-7 py-1.5 text-sm font-semibold rounded-lg border border-stone-200 bg-white text-stone-700 cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent/30"
            >
              <option value="current">Sprint {sprint.number}</option>
              {futureSprints.map((num) => (
                <option key={`future-${num}`} value={num}>
                  Sprint {num} (upcoming)
                </option>
              ))}
              {sortedSnapshots.map((snap) => (
                <option key={snap.sprintNumber} value={snap.sprintNumber}>
                  Sprint {snap.sprintNumber}{snap.name ? ` — ${snap.name}` : ""}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
              <ChevronDown className="w-3.5 h-3.5 text-stone-400" />
            </div>
          </div>

          {/* Sprint info */}
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-stone-400">
            <Calendar className="w-3.5 h-3.5" />
            {formatDate(sprint.startDate)} – {formatDate(sprint.endDate)}
          </div>
          {sprint.focus && (
            <span className="hidden md:inline text-xs text-accent">{sprint.focus}</span>
          )}

          <span className="hidden sm:block w-px h-5 bg-stone-200" />

          {/* Actions */}
          <button
            onClick={() => syncFeaturesMut.mutate()}
            disabled={syncFeaturesMut.isPending}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-stone-200 text-xs text-stone-500 hover:text-accent hover:border-accent/30 transition-colors cursor-pointer"
          >
            <RefreshCw size={12} className={syncFeaturesMut.isPending ? "animate-spin" : ""} />
            <span className="hidden sm:inline">{syncFeaturesMut.isPending ? "Syncing..." : "Sync"}</span>
          </button>
          {isAdmin && !isViewingFutureSprint && !activeSnapshot && (
            <button
              onClick={() => setShowNewSprint(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-stone-200 text-xs text-stone-500 hover:text-accent hover:border-accent/30 transition-colors cursor-pointer"
            >
              <Lock size={12} />
              <span className="hidden sm:inline">Close Sprint</span>
            </button>
          )}
          {isAdmin && isViewingFutureSprint && viewingFutureSprint && (
            <button
              onClick={async () => {
                const ok = await confirm({ title: `Set Sprint ${viewingFutureSprint} as the current sprint?`, confirmLabel: "Set sprint" });
                if (!ok) return;
                const currentEnd = new Date(sprint.endDate);
                const durationMs = new Date(sprint.endDate).getTime() - new Date(sprint.startDate).getTime();
                const start = new Date(currentEnd.getTime() + 86400000);
                const end = new Date(start.getTime() + durationMs);
                const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                saveSprintMut.mutate(
                  { number: viewingFutureSprint, name: "", startDate: fmt(start), endDate: fmt(end), focus: "" },
                  { onSuccess: () => { setViewingSprint(null); onUrlChange?.(null, null); } },
                );
              }}
              disabled={saveSprintMut.isPending}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-accent/30 text-xs text-accent hover:bg-accent/5 transition-colors cursor-pointer disabled:opacity-50"
            >
              {saveSprintMut.isPending ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
              <span className="hidden sm:inline">{saveSprintMut.isPending ? "Setting..." : "Set as Current Sprint"}</span>
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => setShowBackfill(!showBackfill)}
              className="px-2 py-1.5 text-xs text-stone-400 hover:text-accent cursor-pointer"
            >
              +
            </button>
          )}
        </div>
      </div>

      {/* Backfill form */}
      {isAdmin && showBackfill && (
        <BackfillForm
          features={features ?? []}
          mergedPRs={mergedPRs}
          closedIssues={closedIssues}
          allIssues={allIssues}
          isPending={saveSnapshotsMut.isPending}
          backfillNumber={backfillNumber} setBackfillNumber={setBackfillNumber}
          backfillName={backfillName} setBackfillName={setBackfillName}
          backfillStart={backfillStart} setBackfillStart={setBackfillStart}
          backfillEnd={backfillEnd} setBackfillEnd={setBackfillEnd}
          backfillFocus={backfillFocus} setBackfillFocus={setBackfillFocus}
          onSave={(snap: SprintSnapshot) => {
            const existing = (snapshots ?? []).filter((s) => s.sprintNumber !== snap.sprintNumber);
            saveSnapshotsMut.mutate([...existing, snap], {
              onSuccess: () => { setShowBackfill(false); setBackfillName(""); setBackfillStart(""); setBackfillEnd(""); setBackfillFocus(""); },
            });
          }}
          onCancel={() => setShowBackfill(false)}
        />
      )}

      {/* Past sprint snapshot view */}
      {activeSnapshot && (
        <SnapshotView
          snapshot={activeSnapshot}
          isAdmin={isAdmin}
          isLatestSnapshot={activeSnapshot.sprintNumber === (sprint.number - 1)}
          onRevert={async () => {
            const ok = await confirm({ title: `Revert to Sprint ${activeSnapshot.sprintNumber}?`, message: "This will restore the sprint config and reopen its milestone.", variant: "danger", confirmLabel: "Revert" });
            if (ok) revertSprintMut.mutate(
                { snapshot: activeSnapshot },
                { onSuccess: () => setViewingSprint(null) },
              );
          }}
          isReverting={revertSprintMut.isPending}
        />
      )}

      {/* Kanban view */}
      {!activeSnapshot && (
        <FeaturesView
          sprintFeatures={sprintFeatures}
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
          singleColumn={isViewingFutureSprint}
        />
      )}

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

      {/* Close Sprint modal */}
      {showNewSprint && (
        <NewSprintModal
          currentSprint={sprint}
          features={features ?? []}
          targetOptions={[
            ...futureSprints.map((num) => ({ value: num, label: `Sprint ${num}` })),
          ]}
          isPending={advanceSprintMut.isPending}
          failedCount={advanceFailedCount}
          onClose={() => { setShowNewSprint(false); setAdvanceFailedCount(0); }}
          onConfirm={(newSprint) => {
            setAdvanceFailedCount(0);
            const sf = (features ?? []).filter((f) => f.sprint === sprint.number && f.status !== "future");
            const inRange = (dateStr: string) => dateStr >= sprint.startDate && dateStr <= sprint.endDate + "T23:59:59";

            const sprintMergedPRs = (mergedPRs ?? []).filter((pr: any) => pr.merged_at && inRange(pr.merged_at));
            const sprintClosedIssues = (closedIssues ?? []).filter((i: any) => i.closed_at && inRange(i.closed_at));
            const engineerMap = new Map<string, { tasksDone: number; tasksOpen: number; prsMerged: number; issuesClosed: number }>();
            const getEng = (login: string) => {
              if (!engineerMap.has(login)) engineerMap.set(login, { tasksDone: 0, tasksOpen: 0, prsMerged: 0, issuesClosed: 0 });
              return engineerMap.get(login)!;
            };
            for (const pr of sprintMergedPRs) { const login = (pr as any).user?.login ?? (pr as any).author; if (login) getEng(login).prsMerged++; }
            for (const issue of sprintClosedIssues) { const login = (issue as any).closed_by ?? (issue as any).assignee; if (login) getEng(login).issuesClosed++; }

            const snapshot: Omit<SprintSnapshot, "createdAt"> = {
              sprintNumber: sprint.number, name: sprint.name, startDate: sprint.startDate, endDate: sprint.endDate, focus: sprint.focus,
              metrics: {
                prsMerged: sprintMergedPRs.length,
                issuesCreated: (allIssues ?? []).filter((i: any) => inRange(i.created_at)).length,
                issuesClosed: sprintClosedIssues.length,
                featuresCompleted: sf.filter((f) => f.status === "production").length,
                featuresCarriedOver: sf.filter((f) => f.status !== "production").length,
                tasksDone: 0,
                tasksOpen: 0,
                rolesCompleted: 0,
                totalRoles: 0,
              },
              features: sf.map((f) => ({ title: f.title, status: f.status, owners: f.owners })),
              engineers: Array.from(engineerMap.entries()).map(([login, data]) => ({ login, ...data })),
              prsMerged: sprintMergedPRs.map((pr: any) => ({
                number: pr.number,
                title: pr.title,
                repo: pr.repo ?? pr.head?.repo?.name ?? "",
                author: pr.user?.login ?? "",
                mergedAt: pr.merged_at,
                url: pr.html_url,
              })),
              issuesClosed: sprintClosedIssues.map((issue: any) => ({
                number: issue.number,
                title: issue.title,
                repo: issue.repo ?? "",
                closedBy: issue.closed_by ?? issue.user?.login,
                closedAt: issue.closed_at,
                url: issue.html_url,
              })),
            };
            advanceSprintMut.mutate(
              { newSprint, oldSprintNumber: sprint.number, features: features ?? [], snapshot },
              { onSuccess: (result) => { if (result.failed.length === 0) setShowNewSprint(false); else setAdvanceFailedCount(result.failed.length); } },
            );
          }}
        />
      )}
      <ConfirmDialog {...dialogProps} />
    </div>
  );
}

// ─── Features (Kanban) View ────────────────────────────────────────────

interface FeaturesViewProps {
  sprintFeatures: Feature[];
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
  singleColumn?: boolean;
}

function FeaturesView({
  sortedColumns, searchQuery, setSearchQuery, selectedPersons, setSelectedPersons,
  personPills, allPeopleNames,
  sortBy, setSortBy, dragOverCol, onDragStart, onDragOver, onDragLeave, onDrop,
  onUpdate, onDelete, onOpenDetail, onAdd, isAdmin, singleColumn,
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
      {singleColumn ? (
        <div>
          {(() => {
            const todoCol = COLUMN_DEFS.find((c) => c.status === "todo")!;
            const items = sortedColumns.todo;
            return (
              <div
                role="list"
                aria-label={`${todoCol.label} column`}
                onDragOver={(e) => onDragOver(e, todoCol.status)}
                onDragLeave={onDragLeave}
                onDrop={(e) => onDrop(e, todoCol.status)}
                className={cn(
                  "rounded-xl border border-stone-200  bg-stone-50  transition-colors",
                  dragOverCol === todoCol.status && "border-accent/50 bg-accent/5",
                )}
              >
                <div className="px-4 py-3 border-b border-stone-100 bg-white rounded-t-xl flex items-center gap-2">
                  <span className={cn("w-2.5 h-2.5 rounded-full", todoCol.color)} />
                  <span className="text-sm font-medium text-stone-700">
                    {todoCol.label}
                  </span>
                  <span className="text-xs text-stone-400 ml-auto">{items.length}</span>
                </div>
                <div className="p-2 pb-3 space-y-2">
                  {items.map((feature) => (
                    <FeatureCard
                      key={feature.id}
                      feature={feature}
                      allPeople={allPeopleNames}
                      onUpdate={onUpdate}
                      onDelete={onDelete}
                      onOpenDetail={onOpenDetail}
                      mode="sprint"
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
          })()}
        </div>
      ) : (
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
                      mode="sprint"
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
      )}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function BackfillForm({ features, mergedPRs, closedIssues, allIssues, isPending,
  backfillNumber, setBackfillNumber, backfillName, setBackfillName, backfillStart, setBackfillStart,
  backfillEnd, setBackfillEnd, backfillFocus, setBackfillFocus, onSave, onCancel,
}: any) {
  return (
    <div className="bg-white rounded-xl border border-stone-200 p-4 space-y-3">
      <h4 className="text-sm font-semibold text-stone-800">Backfill Sprint Snapshot</h4>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className="text-xs text-stone-500 block mb-1">Sprint #</label>
          <input type="number" min={1} value={backfillNumber} onChange={(e: any) => setBackfillNumber(parseInt(e.target.value) || 1)}
            className="w-full px-3 py-2 rounded-lg border border-stone-200 bg-white text-stone-900 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30" />
        </div>
        <div>
          <label className="text-xs text-stone-500 block mb-1">Name</label>
          <input type="text" value={backfillName} onChange={(e: any) => setBackfillName(e.target.value)} placeholder="Sprint name..."
            className="w-full px-3 py-2 rounded-lg border border-stone-200 bg-white text-stone-900 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30" />
        </div>
        <div>
          <label className="text-xs text-stone-500 block mb-1">Start Date</label>
          <input type="date" value={backfillStart} onChange={(e: any) => setBackfillStart(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-stone-200 bg-white text-stone-900 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30" />
        </div>
        <div>
          <label className="text-xs text-stone-500 block mb-1">End Date</label>
          <input type="date" value={backfillEnd} onChange={(e: any) => setBackfillEnd(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-stone-200 bg-white text-stone-900 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30" />
        </div>
      </div>
      <div>
        <label className="text-xs text-stone-500 block mb-1">Focus</label>
        <input type="text" value={backfillFocus} onChange={(e: any) => setBackfillFocus(e.target.value)} placeholder="Sprint focus..."
          className="w-full px-3 py-2 rounded-lg border border-stone-200 bg-white text-stone-900 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30" />
      </div>
      <div className="flex items-center gap-2">
        <button
          disabled={!backfillStart || !backfillEnd || isPending}
          onClick={() => {
            const inRange = (dateStr: string) => dateStr >= backfillStart && dateStr <= backfillEnd + "T23:59:59";
            const bf = (features ?? []).filter((f: Feature) => f.sprint === backfillNumber);
            const snap: SprintSnapshot = {
              sprintNumber: backfillNumber, name: backfillName, startDate: backfillStart, endDate: backfillEnd, focus: backfillFocus,
              metrics: {
                prsMerged: (mergedPRs ?? []).filter((pr: any) => pr.merged_at && inRange(pr.merged_at)).length,
                issuesCreated: (allIssues ?? []).filter((i: any) => inRange(i.created_at)).length,
                issuesClosed: (closedIssues ?? []).filter((i: any) => i.closed_at && inRange(i.closed_at)).length,
                featuresCompleted: bf.filter((f: Feature) => f.status === "production").length,
                featuresCarriedOver: bf.filter((f: Feature) => f.status !== "production" && f.status !== "future").length,
                tasksDone: 0, tasksOpen: 0, rolesCompleted: 0, totalRoles: 0,
              },
              features: bf.map((f: Feature) => ({ title: f.title, status: f.status, owners: f.owners })),
              createdAt: new Date().toISOString(),
            };
            onSave(snap);
          }}
          className="px-4 py-2 bg-accent text-white text-sm font-medium rounded-lg hover:bg-accent/90 disabled:opacity-50 cursor-pointer"
        >
          {isPending ? "Saving..." : "Create Snapshot"}
        </button>
        <button onClick={onCancel} className="px-4 py-2 border border-stone-200 text-sm text-stone-600 rounded-lg hover:bg-stone-50 cursor-pointer">Cancel</button>
      </div>
    </div>
  );
}

// ─── Snapshot View ──────────────────────────────────────────────────────

const SNAPSHOT_STATUS_COLS: { status: BoardStatus; label: string; color: string }[] = COLUMN_DEFS;

function SnapshotView({ snapshot, isAdmin, isLatestSnapshot, onRevert, isReverting }: {
  snapshot: SprintSnapshot;
  isAdmin?: boolean;
  isLatestSnapshot?: boolean;
  onRevert?: () => void;
  isReverting?: boolean;
}) {
  const { metrics, features: snapshotFeatures } = snapshot;
  const [selectedEngineer, setSelectedEngineer] = useState<string | null>(null);
  const engineers = snapshot.engineers ?? [];

  // Filtered metrics when engineer is selected
  const eng = selectedEngineer ? engineers.find((e) => e.login === selectedEngineer) : null;
  const m = eng
    ? { ...metrics, prsMerged: eng.prsMerged, issuesClosed: eng.issuesClosed, tasksDone: eng.tasksDone, tasksOpen: eng.tasksOpen }
    : metrics;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-stone-800">
            Sprint {snapshot.sprintNumber}
            {snapshot.name && <span className="text-stone-400 font-normal ml-2">— {snapshot.name}</span>}
          </h2>
          <span className="text-xs text-stone-400">
            {formatDate(snapshot.startDate)} – {formatDate(snapshot.endDate)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Engineer filter */}
          {engineers.length > 0 && (
            <PersonSelect
              value={selectedEngineer}
              onChange={(v) => setSelectedEngineer(typeof v === "string" ? v : null)}
              options={engineers.map((e) => ({ value: e.login, label: e.login }))}
              placeholder="All Engineers"
            />
          )}

          {/* Revert button — admin only, latest snapshot only */}
          {isAdmin && isLatestSnapshot && onRevert && (
            <button
              onClick={onRevert}
              disabled={isReverting}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-red-200 text-xs text-red-500 hover:text-red-600 hover:border-red-300 transition-colors cursor-pointer disabled:opacity-50"
            >
              {isReverting ? <Loader2 size={12} className="animate-spin" /> : <Undo2 size={12} />}
              <span>{isReverting ? "Reverting..." : "Revert Sprint"}</span>
            </button>
          )}
        </div>
      </div>

      {snapshot.focus && <p className="text-sm text-accent">{snapshot.focus}</p>}

      {/* Feature kanban board */}
      {snapshotFeatures.length > 0 && (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          {SNAPSHOT_STATUS_COLS.map((col) => {
            const cards = snapshotFeatures.filter((f) => f.status === col.status);
            return (
              <div key={col.status} className="bg-white rounded-xl border border-stone-200 min-h-[120px]">
                <div className="flex items-center gap-2 px-3 py-2.5 border-b border-stone-100">
                  <span className={cn("w-2 h-2 rounded-full", col.color)} />
                  <span className="text-xs font-semibold text-stone-600">{col.label}</span>
                  <span className="text-xs text-stone-400 ml-auto">{cards.length}</span>
                </div>
                <div className="p-2 space-y-2">
                  {cards.map((f, i) => (
                    <div key={i} className={cn("rounded-lg border border-stone-200  p-2.5", f.status === "production" && "opacity-60")}>
                      <div className="text-xs font-medium text-stone-700 leading-snug">{f.title}</div>
                      {f.owners.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {f.owners.map((o) => (
                            <span key={o} className="text-[10px] bg-stone-100 border border-stone-200 px-1.5 py-0.5 rounded-full text-stone-500">{o}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Top-level metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {([
          ["Features Shipped", metrics.featuresCompleted, "text-stone-700  "],
          ["Carried Over", metrics.featuresCarriedOver, "text-amber-600  "],
          ["PRs Merged", m.prsMerged, "text-accent"],
          ["Issues Closed", m.issuesClosed, "text-purple-600  "],
        ] as const).map(([label, value, color]) => (
          <div key={label} className="bg-white rounded-xl border border-stone-200 px-3 py-3 text-center">
            <div className={cn("text-2xl font-semibold", color)}>{value}</div>
            <div className="text-[10px] text-stone-400 uppercase tracking-wider mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Engineer breakdown */}
      {engineers.length > 0 && !selectedEngineer && (
        <div className="bg-white rounded-xl border border-stone-200 p-4">
          <h3 className="text-xs font-medium text-stone-400 uppercase tracking-wider mb-3">Engineer Breakdown</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-stone-400 uppercase tracking-wider">
                  <th className="pb-2 pr-4 font-medium">Engineer</th>
                  <th className="pb-2 pr-4 font-medium text-center">PRs Merged</th>
                  <th className="pb-2 font-medium text-center">Issues Closed</th>
                </tr>
              </thead>
              <tbody>
                {engineers
                  .sort((a, b) => (b.prsMerged + b.issuesClosed) - (a.prsMerged + a.issuesClosed))
                  .map((e) => (
                    <tr
                      key={e.login}
                      onClick={() => setSelectedEngineer(e.login)}
                      className="border-t border-stone-100 hover:bg-stone-50 cursor-pointer"
                    >
                      <td className="py-2 pr-4 text-stone-700 font-medium">{e.login}</td>
                      <td className="py-2 pr-4 text-center text-stone-600">{e.prsMerged}</td>
                      <td className="py-2 text-center text-stone-600">{e.issuesClosed}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
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
