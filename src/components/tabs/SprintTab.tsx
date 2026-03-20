import { useMemo, useState, useCallback } from "react";
import { useSprint, useFeatures, usePeople, useCreateFeature, useUpdateFeature, useDeleteFeature, useCreateConfigRepo, useLegacyFeatures, useMigrateFeatures, useAdvanceSprint, useSprintSnapshots, useSaveSprintSnapshots, useSyncFeatures, useAllSprintSubIssues, useTodosClosedInRange } from "@/hooks/useConfigRepo";
import { FeatureCard } from "@/components/sprint/FeatureCard";
import { FeatureDetailModal } from "@/components/sprint/FeatureDetailModal";
import { NewSprintModal } from "@/components/sprint/NewSprintModal";
import { AddFeatureInput } from "@/components/sprint/AddFeatureInput";
import { SprintMetrics } from "@/components/sprint/SprintMetrics";
import { useIsAdmin, useMergedPRs, useClosedIssues, useAllIssues, useActiveMembers } from "@/hooks/useGitHub";
import { useAuth } from "@/lib/auth";
import { useSidebar } from "@/lib/sidebar";
import { withStatusTransition } from "@/lib/github-features";
import type { Feature, FeatureStatus, SprintSnapshot } from "@/lib/types";
import { Calendar, Rocket, ArrowUpDown, Upload, Loader2, FastForward, RefreshCw, Search, LayoutGrid, BarChart3, Users, ListChecks, ChevronDown, List } from "lucide-react";
import { Spinner } from "@/components/Spinner";
import { PersonSelect } from "@/components/ui/PersonSelect";
import { cn } from "@/lib/cn";

type SprintView = "features" | "roles" | "tasks" | "metrics";
type SortKey = "default" | "title";

type BoardStatus = Exclude<FeatureStatus, "future">;
const COLUMN_DEFS: { status: BoardStatus; label: string; color: string }[] = [
  { status: "plan", label: "Plan", color: "bg-brand" },
  { status: "in_progress", label: "In Progress", color: "bg-amber-500" },
  { status: "demo", label: "Demo", color: "bg-purple-500" },
  { status: "tested", label: "Tested", color: "bg-cyan-500" },
  { status: "production", label: "In Production", color: "bg-green-500" },
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
}

export function SprintTab({ repoNames, navFilter }: SprintTabProps) {
  const { data: sprint, isLoading: sprintLoading } = useSprint();
  const { data: features } = useFeatures();
  const { data: people } = usePeople();
  const { data: orgMembers } = useActiveMembers();
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
  const { user } = useAuth();
  const { data: mergedPRs } = useMergedPRs(repoNames);
  const { data: closedIssues } = useClosedIssues(repoNames);
  const { data: allIssues } = useAllIssues(repoNames);
  const { data: completedTodos } = useTodosClosedInRange(sprint?.startDate, sprint?.endDate);
  const { viewingSprint, setViewingSprint } = useSidebar();

  const [sprintView, setSprintView] = useState<SprintView>((navFilter?.view as SprintView) || "features");
  const [detailFeature, setDetailFeature] = useState<Feature | null>(null);
  const [showNewSprint, setShowNewSprint] = useState(false);
  const [advanceFailedCount, setAdvanceFailedCount] = useState(0);
  const [sortBy, setSortBy] = useState<SortKey>("title");
  const [selectedPersons, setSelectedPersons] = useState<string[]>(navFilter?.person ? [navFilter.person] : []);
  const [searchQuery, setSearchQuery] = useState("");
  const [migrateProgress, setMigrateProgress] = useState<{ done: number; total: number } | null>(null);
  const [migrateDismissed, setMigrateDismissed] = useState(false);
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

  // All sprint features (unfiltered, for metrics view)
  const allSprintFeatures = useMemo(() => {
    return (features ?? []).filter((f) => f.sprint === effectiveSprintNumber && f.status !== "future");
  }, [features, effectiveSprintNumber]);

  const metricsFeatureIds = useMemo(() => allSprintFeatures.map((f) => f.id), [allSprintFeatures]);
  const { data: allTasks, isLoading: tasksLoading } = useAllSprintSubIssues(metricsFeatureIds);

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
    plan: sortFeatures(sprintFeatures.filter((f) => f.status === "plan"), sortBy),
    in_progress: sortFeatures(sprintFeatures.filter((f) => f.status === "in_progress"), sortBy),
    demo: sortFeatures(sprintFeatures.filter((f) => f.status === "demo"), sortBy),
    tested: sortFeatures(sprintFeatures.filter((f) => f.status === "tested"), sortBy),
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

  const deleteFeature = (id: number) => { deleteFeatureMut.mutate(id); };

  const addFeature = (title: string) => {
    createFeatureMut.mutate({ title, status: "plan", sprint: sprint?.number ?? null });
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
        <h3 className="text-lg font-semibold text-stone-700 dark:text-neutral-300 mb-1">No sprint configured yet</h3>
        <p className="text-sm text-stone-400 dark:text-neutral-500 mb-6 max-w-sm mx-auto">
          Create a <code className="bg-stone-100 dark:bg-dark-overlay px-1 rounded">.gitpulse</code> config repo to start tracking sprints, features, and your team.
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

  const VIEW_TABS: { key: SprintView; label: string; icon: typeof LayoutGrid }[] = [
    { key: "features", label: "Features", icon: LayoutGrid },
    { key: "roles", label: "Roles", icon: Users },
    { key: "tasks", label: "Tasks", icon: ListChecks },
    { key: "metrics", label: "Metrics", icon: BarChart3 },
  ];

  return (
    <div className="space-y-4 pb-8">
      {/* Migration banner */}
      {showMigrationBanner && (
        <MigrationBanner
          legacyCount={legacyFeatures!.length}
          isPending={migrateMut.isPending}
          progress={migrateProgress}
          onMigrate={() => {
            migrateMut.mutate({
              legacy: legacyFeatures!,
              onProgress: (done, total) => setMigrateProgress({ done, total }),
            });
          }}
          onDismiss={() => setMigrateDismissed(true)}
        />
      )}

      {/* Sprint header bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          {/* Sprint selector */}
          <div className="relative">
            <select
              value={viewingSprint ?? "current"}
              onChange={(e) => {
                const val = e.target.value;
                setViewingSprint(val === "current" ? null : Number(val));
              }}
              className="appearance-none pl-2.5 pr-7 py-1.5 text-sm font-semibold rounded-lg border border-stone-200 dark:border-white/[0.06] bg-white dark:bg-dark-overlay text-stone-700 dark:text-neutral-200 cursor-pointer focus:outline-none focus:ring-1 focus:ring-brand/30"
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
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-stone-400 dark:text-neutral-500">
            <Calendar className="w-3.5 h-3.5" />
            {formatDate(sprint.startDate)} – {formatDate(sprint.endDate)}
          </div>
          {sprint.focus && (
            <span className="hidden md:inline text-xs text-brand">{sprint.focus}</span>
          )}

          <span className="hidden sm:block w-px h-5 bg-stone-200 dark:bg-white/[0.1]" />

          {/* Actions */}
          <button
            onClick={() => syncFeaturesMut.mutate()}
            disabled={syncFeaturesMut.isPending}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-stone-200 dark:border-white/[0.06] text-xs text-stone-500 dark:text-neutral-400 hover:text-brand hover:border-brand/30 transition-colors cursor-pointer"
          >
            <RefreshCw size={12} className={syncFeaturesMut.isPending ? "animate-spin" : ""} />
            <span className="hidden sm:inline">{syncFeaturesMut.isPending ? "Syncing..." : "Sync"}</span>
          </button>
          <button
            onClick={() => setShowNewSprint(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-stone-200 dark:border-white/[0.06] text-xs text-stone-500 dark:text-neutral-400 hover:text-brand hover:border-brand/30 transition-colors cursor-pointer"
          >
            <FastForward size={12} />
            <span className="hidden sm:inline">New Sprint</span>
          </button>
          {isAdmin && (
            <button
              onClick={() => setShowBackfill(!showBackfill)}
              className="px-2 py-1.5 text-xs text-stone-400 dark:text-neutral-500 hover:text-brand cursor-pointer"
            >
              +
            </button>
          )}
        </div>

        {/* View tabs — ClickUp style */}
        {!activeSnapshot && (
          <div className="flex items-center bg-stone-100 dark:bg-dark-overlay rounded-lg p-0.5">
            {VIEW_TABS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setSprintView(key)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer transition-all",
                  sprintView === key
                    ? "bg-white dark:bg-dark-raised text-stone-800 dark:text-neutral-200 shadow-sm"
                    : "text-stone-500 dark:text-neutral-400 hover:text-stone-700 dark:hover:text-neutral-300",
                )}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Backfill form */}
      {isAdmin && showBackfill && (
        <BackfillForm
          sprint={sprint}
          features={features ?? []}
          mergedPRs={mergedPRs}
          closedIssues={closedIssues}
          allIssues={allIssues}
          snapshots={snapshots ?? []}
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
      {activeSnapshot && <SnapshotView snapshot={activeSnapshot} />}

      {/* Metrics view */}
      {!activeSnapshot && sprintView === "metrics" && (
        <SprintMetrics
          sprint={sprint}
          sprintFeatures={allSprintFeatures}
          people={people}
          allTasks={allTasks}
          tasksLoading={tasksLoading}
        />
      )}

      {/* Features (kanban) view */}
      {!activeSnapshot && sprintView === "features" && (
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
          onOpenDetail={setDetailFeature}
          onAdd={addFeature}
          isAdmin={isAdmin}
          singleColumn={isViewingFutureSprint}
        />
      )}

      {/* Roles view */}
      {!activeSnapshot && sprintView === "roles" && (
        <RolesView
          sprintFeatures={sprintFeatures}
          allTasks={allTasks}
          tasksLoading={tasksLoading}
          people={people}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          selectedPersons={selectedPersons}
          setSelectedPersons={setSelectedPersons}
          personPills={personPills}
          onOpenDetail={setDetailFeature}
          features={features}
        />
      )}

      {/* Tasks view */}
      {!activeSnapshot && sprintView === "tasks" && (
        <TasksView
          allTasks={allTasks}
          tasksLoading={tasksLoading}
          sprintFeatures={allSprintFeatures}
          people={people}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          selectedPersons={selectedPersons}
          setSelectedPersons={setSelectedPersons}
          personPills={personPills}
        />
      )}

      {/* Detail modal */}
      {detailFeature && (
        <FeatureDetailModal
          key={detailFeature.id}
          feature={detailFeature}
          allPeople={allPeopleNames}
          onClose={() => setDetailFeature(null)}
          onUpdate={updateFeature}
          sprintOptions={sprintOptions}
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
            const tasks = allTasks ?? [];
            const roles = tasks.filter((t) => t.roleName === undefined && t.roleNumber !== undefined);
            const actualTasks = tasks.filter((t) => t.roleNumber === undefined || t.roleName !== undefined);
            const doneTasks = actualTasks.filter((t) => t.state === "closed");
            const openTasks = actualTasks.filter((t) => t.state === "open");
            const donePoints = doneTasks.reduce((s, t) => s + (t.points ?? 0), 0);
            const totalPoints = actualTasks.reduce((s, t) => s + (t.points ?? 0), 0);
            const rolesCompleted = roles.filter((r) => r.state === "closed").length;

            // Per-engineer breakdown
            const sprintMergedPRs = (mergedPRs ?? []).filter((pr: any) => pr.merged_at && inRange(pr.merged_at));
            const sprintClosedIssues = (closedIssues ?? []).filter((i: any) => i.closed_at && inRange(i.closed_at));
            const engineerMap = new Map<string, { tasksDone: number; tasksOpen: number; points: number; prsMerged: number; issuesClosed: number }>();
            const getEng = (login: string) => {
              if (!engineerMap.has(login)) engineerMap.set(login, { tasksDone: 0, tasksOpen: 0, points: 0, prsMerged: 0, issuesClosed: 0 });
              return engineerMap.get(login)!;
            };
            for (const t of actualTasks) {
              for (const a of t.assignees) {
                const e = getEng(a);
                if (t.state === "closed") { e.tasksDone++; e.points += t.points ?? 0; }
                else e.tasksOpen++;
              }
            }
            for (const pr of sprintMergedPRs) { const login = (pr as any).user?.login ?? (pr as any).author; if (login) getEng(login).prsMerged++; }
            for (const issue of sprintClosedIssues) { const login = (issue as any).closed_by ?? (issue as any).assignee; if (login) getEng(login).issuesClosed++; }

            const snapshot: Omit<SprintSnapshot, "createdAt"> = {
              sprintNumber: sprint.number, name: sprint.name, startDate: sprint.startDate, endDate: sprint.endDate, focus: sprint.focus,
              metrics: {
                prsMerged: sprintMergedPRs.length,
                issuesCreated: (allIssues ?? []).filter((i: any) => inRange(i.created_at)).length,
                issuesClosed: sprintClosedIssues.length,
                featuresCompleted: sf.filter((f) => f.status === "production").length,
                featuresCarriedOver: sf.filter((f) => f.status === "plan" || f.status === "demo").length,
                tasksDone: doneTasks.length,
                tasksOpen: openTasks.length,
                totalPoints,
                donePoints,
                rolesCompleted,
                totalRoles: roles.length,
              },
              features: sf.map((f) => ({ title: f.title, status: f.status, owners: f.owners })),
              engineers: Array.from(engineerMap.entries()).map(([login, data]) => ({ login, ...data })),
              todosCompleted: (completedTodos ?? []).map((t) => ({
                title: t.title,
                owner: t.owner,
                closedAt: t.closedAt ?? new Date().toISOString(),
                featureId: t.featureId,
              })),
            };
            advanceSprintMut.mutate(
              { newSprint, oldSprintNumber: sprint.number, features: features ?? [], snapshot },
              { onSuccess: (result) => { if (result.failed.length === 0) setShowNewSprint(false); else setAdvanceFailedCount(result.failed.length); } },
            );
          }}
        />
      )}
    </div>
  );
}

// ─── Features (Kanban) View ────────────────────────────────────────────

interface FeaturesViewProps {
  sprintFeatures: Feature[];
  sortedColumns: Record<"plan" | "in_progress" | "demo" | "tested" | "production", Feature[]>;
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
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 dark:text-neutral-500" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search features..."
            className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-stone-200 dark:border-white/[0.06] bg-white dark:bg-dark-raised text-sm text-stone-700 dark:text-neutral-300 placeholder:text-stone-400 dark:placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
        </div>

        <PersonSelect value={selectedPersons.length > 0 ? selectedPersons : null} onChange={(v) => setSelectedPersons(Array.isArray(v) ? v : v ? [v] : [])} placeholder="All people" multi
          options={personPills.map((p) => ({ value: p.login, label: p.name }))} />

        <div className="flex items-center gap-1">
          <ArrowUpDown size={13} className="text-stone-400 dark:text-neutral-500" />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            className="px-2 py-1.5 rounded-lg border border-stone-200 dark:border-white/[0.06] bg-white dark:bg-dark-raised text-xs text-stone-500 dark:text-neutral-400 focus:outline-none focus:border-brand cursor-pointer"
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
            const planCol = COLUMN_DEFS.find((c) => c.status === "plan")!;
            const items = sortedColumns.plan;
            return (
              <div
                onDragOver={(e) => onDragOver(e, planCol.status)}
                onDragLeave={onDragLeave}
                onDrop={(e) => onDrop(e, planCol.status)}
                className={cn(
                  "rounded-xl border border-stone-200 dark:border-white/[0.06] bg-stone-50 dark:bg-dark-base/50 transition-colors",
                  dragOverCol === planCol.status && "border-brand/50 bg-brand/5",
                )}
              >
                <div className="px-4 py-3 border-b border-stone-100 dark:border-white/[0.06] bg-white dark:bg-dark-raised rounded-t-xl flex items-center gap-2">
                  <span className={cn("w-2.5 h-2.5 rounded-full", planCol.color)} />
                  <span className="text-sm font-medium text-stone-700 dark:text-neutral-300">
                    {planCol.label}
                  </span>
                  <span className="text-xs text-stone-400 dark:text-neutral-500 ml-auto">{items.length}</span>
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
                    <div className="px-3 py-8 text-sm text-stone-400 dark:text-neutral-500 text-center">
                      Drag features here
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-3">
          {COLUMN_DEFS.map((col) => {
            const items = sortedColumns[col.status];
            return (
              <div
                key={col.status}
                onDragOver={(e) => onDragOver(e, col.status)}
                onDragLeave={onDragLeave}
                onDrop={(e) => onDrop(e, col.status)}
                className={cn(
                  "rounded-xl border border-stone-200 dark:border-white/[0.06] bg-stone-50 dark:bg-dark-base/50 transition-colors",
                  dragOverCol === col.status && "border-brand/50 bg-brand/5",
                )}
              >
                <div className="px-4 py-3 border-b border-stone-100 dark:border-white/[0.06] bg-white dark:bg-dark-raised rounded-t-xl flex items-center gap-2">
                  <span className={cn("w-2.5 h-2.5 rounded-full", col.color)} />
                  <span className="text-sm font-medium text-stone-700 dark:text-neutral-300">
                    {col.label}
                  </span>
                  <span className="text-xs text-stone-400 dark:text-neutral-500 ml-auto">{items.length}</span>
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
                    <div className="px-3 py-8 text-sm text-stone-400 dark:text-neutral-500 text-center">
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

// ─── Roles View ────────────────────────────────────────────────────────

import type { SubIssueWithFeature } from "@/hooks/useConfigRepo";
import type { Person } from "@/lib/types";

type TaskStatus = "plan" | "in_progress" | "demo" | "tested" | "production";

function classifyTask(task: SubIssueWithFeature, featureStatus?: FeatureStatus): TaskStatus {
  if (featureStatus === "production") return "production";
  if (featureStatus === "demo") return task.state === "closed" ? "tested" : "demo";
  // feature in "plan" or unknown
  if (task.state === "closed") return "tested";
  return task.assignees.length > 0 ? "in_progress" : "plan";
}

const TASK_COLUMNS: { status: TaskStatus; label: string; color: string }[] = [
  { status: "plan", label: "Plan", color: "bg-brand" },
  { status: "in_progress", label: "In Progress", color: "bg-amber-500" },
  { status: "demo", label: "Demo", color: "bg-purple-500" },
  { status: "tested", label: "Tested", color: "bg-cyan-500" },
  { status: "production", label: "In Production", color: "bg-green-500" },
];

const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  plan: "Plan", in_progress: "In Progress", demo: "Demo", tested: "Tested", production: "In Production",
};
const TASK_STATUS_COLORS: Record<TaskStatus, string> = {
  plan: "text-brand", in_progress: "text-amber-500", demo: "text-purple-500", tested: "text-cyan-500", production: "text-green-500",
};
const TASK_STATUS_DOT: Record<TaskStatus, string> = {
  plan: "bg-brand", in_progress: "bg-amber-500", demo: "bg-purple-500", tested: "bg-cyan-500", production: "bg-green-500",
};

type SubViewMode = "list" | "board";

/** Filter tasks by person and search query */
function filterTasks(
  tasks: SubIssueWithFeature[],
  searchQuery: string,
  selectedPersons: string[],
): SubIssueWithFeature[] {
  const q = searchQuery.toLowerCase().trim();
  return tasks.filter((t) => {
    if (selectedPersons.length > 0 && !t.assignees.some((a) => selectedPersons.some((p) => a.toLowerCase() === p.toLowerCase()))) return false;
    if (q && !t.title.toLowerCase().includes(q) && !t.roleName?.toLowerCase().includes(q)) return false;
    return true;
  });
}

interface RolesViewProps {
  sprintFeatures: Feature[];
  allTasks: SubIssueWithFeature[] | undefined;
  tasksLoading: boolean;
  people: Person[] | undefined;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  selectedPersons: string[];
  setSelectedPersons: (p: string[]) => void;
  personPills: { login: string; name: string }[];
  onOpenDetail: (f: Feature) => void;
  features: Feature[] | undefined;
}

function RolesView({
  sprintFeatures, allTasks, tasksLoading, people, searchQuery, setSearchQuery,
  selectedPersons, setSelectedPersons,
  personPills, onOpenDetail, features,
}: RolesViewProps) {
  const [viewMode, setViewMode] = useState<SubViewMode>("board");

  const filtered = useMemo(
    () => filterTasks(allTasks ?? [], searchQuery, selectedPersons),
    [allTasks, searchQuery, selectedPersons],
  );

  const featureById = useMemo(() => {
    const m = new Map<number, Feature>();
    for (const f of sprintFeatures) m.set(f.id, f);
    return m;
  }, [sprintFeatures]);

  // Build enriched tasks with featureName + featureStatus + person display name
  type EnrichedTask = SubIssueWithFeature & { featureName: string; fStatus: FeatureStatus; personLogin: string; personName: string };

  // Explode tasks by assignee so each person gets their own copy
  const allEnriched = useMemo(() => {
    const items: EnrichedTask[] = [];
    for (const task of filtered) {
      const feat = featureById.get(task.featureId);
      const assignees = task.assignees.length > 0 ? task.assignees : ["Unassigned"];
      for (const assignee of assignees) {
        const person = (people ?? []).find((p) => p.github === assignee);
        items.push({
          ...task,
          featureName: feat?.title ?? "Unknown",
          fStatus: feat?.status ?? "plan",
          personLogin: assignee,
          personName: person?.name || assignee,
        });
      }
    }
    return items;
  }, [filtered, people, featureById]);

  // Get sorted unique people
  const sortedPeople = useMemo(() => {
    const seen = new Map<string, string>();
    for (const t of allEnriched) {
      if (!seen.has(t.personLogin)) seen.set(t.personLogin, t.personName);
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [allEnriched]);

  // Split into columns
  const columns = useMemo(() => {
    const result: Record<TaskStatus, EnrichedTask[]> = { plan: [], in_progress: [], demo: [], tested: [], production: [] };
    for (const t of allEnriched) result[classifyTask(t, t.fStatus)].push(t);
    return result;
  }, [allEnriched]);

  // Group tasks within a column by person
  function groupByPerson(tasks: EnrichedTask[]): [string, string, EnrichedTask[]][] {
    const groups = new Map<string, EnrichedTask[]>();
    for (const t of tasks) {
      const arr = groups.get(t.personLogin) ?? [];
      arr.push(t);
      groups.set(t.personLogin, arr);
    }
    return sortedPeople
      .filter(([login]) => groups.has(login))
      .map(([login, name]) => [login, name, groups.get(login)!]);
  }

  if (tasksLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Filters + view toggle */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 dark:text-neutral-500" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search roles..."
            className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-stone-200 dark:border-white/[0.06] bg-white dark:bg-dark-raised text-sm text-stone-700 dark:text-neutral-300 placeholder:text-stone-400 dark:placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
        </div>
        <PersonSelect value={selectedPersons.length > 0 ? selectedPersons : null} onChange={(v) => setSelectedPersons(Array.isArray(v) ? v : v ? [v] : [])} placeholder="All people" multi
          options={personPills.map((p) => ({ value: p.login, label: p.name }))} />
        <ViewToggle value={viewMode} onChange={setViewMode} />
      </div>

      {allEnriched.length === 0 && (
        <div className="text-center py-12 text-sm text-stone-400 dark:text-neutral-500">
          No tasks with assignees found. Add roles and tasks to features first.
        </div>
      )}

      {/* Board view: 5-column kanban, tasks grouped by person within each column */}
      {viewMode === "board" && allEnriched.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-3">
          {TASK_COLUMNS.map(({ status, label, color }) => {
            const colTasks = columns[status];
            const grouped = groupByPerson(colTasks);
            return (
              <div key={status} className="rounded-xl border border-stone-200 dark:border-white/[0.06] bg-stone-50 dark:bg-dark-base/50">
                <div className="px-4 py-3 border-b border-stone-100 dark:border-white/[0.06] bg-white dark:bg-dark-raised rounded-t-xl flex items-center gap-2">
                  <span className={cn("w-2.5 h-2.5 rounded-full", color)} />
                  <span className="text-sm font-medium text-stone-700 dark:text-neutral-300">{label}</span>
                  <span className="text-xs text-stone-400 dark:text-neutral-500 ml-auto">{colTasks.length}</span>
                </div>
                <div className="p-2 pb-3 overflow-y-auto max-h-[calc(100vh-260px)] space-y-3">
                  {grouped.map(([login, name, tasks]) => (
                    <div key={login}>
                      {/* Person sub-header */}
                      <div className="flex items-center gap-2 px-1 mb-1.5">
                        <div className="w-5 h-5 rounded-full bg-brand/10 flex items-center justify-center text-brand text-[9px] font-bold shrink-0">
                          {name.slice(0, 2).toUpperCase()}
                        </div>
                        <span className="text-[11px] font-medium text-stone-500 dark:text-neutral-400 truncate">{name}</span>
                        <span className="text-[10px] text-stone-400 dark:text-neutral-500">{tasks.length}</span>
                      </div>
                      <div className="space-y-1.5">
                        {tasks.map((task) => (
                          <RoleTaskCard key={`${task.id}-${login}`} task={task} onOpenDetail={onOpenDetail} features={features} />
                        ))}
                      </div>
                    </div>
                  ))}
                  {colTasks.length === 0 && (
                    <div className="px-3 py-8 text-sm text-stone-400 dark:text-neutral-500 text-center">—</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* List view: table grouped by person with status column */}
      {viewMode === "list" && allEnriched.length > 0 && (
        <div className="bg-white dark:bg-dark-raised rounded-xl border border-stone-200 dark:border-white/[0.06] overflow-hidden">
          <div className="grid grid-cols-[1fr_140px_100px_80px_60px] gap-2 px-4 py-2 border-b border-stone-100 dark:border-white/[0.06] text-[10px] uppercase tracking-wider font-medium text-stone-400 dark:text-neutral-500">
            <span>Task</span>
            <span>Feature</span>
            <span>Status</span>
            <span>Role</span>
            <span className="text-right">Pts</span>
          </div>
          {sortedPeople.map(([login, name]) => {
            const personTasks = allEnriched.filter((t) => t.personLogin === login);
            if (personTasks.length === 0) return null;
            const doneCount = personTasks.filter((t) => t.state === "closed").length;
            const totalPts = personTasks.reduce((s, t) => s + (t.points ?? 0), 0);
            const donePts = personTasks.filter((t) => t.state === "closed").reduce((s, t) => s + (t.points ?? 0), 0);
            return (
              <div key={login}>
                <div className="px-4 py-2 bg-stone-50 dark:bg-dark-overlay border-b border-stone-100 dark:border-white/[0.06] flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full bg-brand/10 flex items-center justify-center text-brand text-[9px] font-bold shrink-0">
                    {name.slice(0, 2).toUpperCase()}
                  </div>
                  <span className="text-xs font-medium text-stone-700 dark:text-neutral-300">{name}</span>
                  <span className="text-[10px] text-stone-400 dark:text-neutral-500 ml-auto">
                    {doneCount}/{personTasks.length} done · {donePts}/{totalPts} pts
                  </span>
                </div>
                {personTasks.map((task) => {
                  const s = classifyTask(task, task.fStatus);
                  const statusLabel = TASK_STATUS_LABELS[s];
                  const statusColor = TASK_STATUS_COLORS[s];
                  return (
                    <div key={`${task.id}-${login}`} className={cn(
                      "grid grid-cols-[1fr_140px_100px_80px_60px] gap-2 px-4 py-2 border-b border-stone-50 dark:border-white/[0.03] hover:bg-stone-50 dark:hover:bg-white/[0.03] items-center",
                      s === "production" && "opacity-60",
                    )}>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={cn("w-2 h-2 rounded-full shrink-0", TASK_STATUS_DOT[s])} />
                        <a href={task.html_url} target="_blank" rel="noopener noreferrer" className="text-sm text-stone-700 dark:text-neutral-300 truncate hover:text-brand">{task.title}</a>
                      </div>
                      <span className="text-xs text-stone-400 dark:text-neutral-500 truncate">{task.featureName}</span>
                      <span className={cn("text-[10px] font-medium", statusColor)}>{statusLabel}</span>
                      <span className="text-xs text-stone-400 dark:text-neutral-500 truncate">{task.roleName ?? "—"}</span>
                      <span className="text-xs text-stone-500 dark:text-neutral-400 text-right font-medium">{task.points ?? "—"}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RoleTaskCard({ task, onOpenDetail, features }: {
  task: SubIssueWithFeature & { featureName: string; fStatus?: FeatureStatus };
  onOpenDetail: (f: Feature) => void;
  features: Feature[] | undefined;
}) {
  const status = classifyTask(task, task.fStatus);
  return (
    <div className={cn(
      "bg-white dark:bg-dark-raised rounded-lg p-2.5 border border-stone-200 dark:border-white/[0.06] shadow-sm",
      status === "production" && "opacity-60",
    )}>
      <a href={task.html_url} target="_blank" rel="noopener noreferrer"
        className="text-xs font-medium text-stone-700 dark:text-neutral-300 hover:text-brand leading-snug line-clamp-2 block">
        {task.title}
      </a>
      <div className="flex items-center gap-1.5 mt-1.5">
        <button
          onClick={() => {
            const f = (features ?? []).find((feat) => feat.title === task.featureName);
            if (f) onOpenDetail(f);
          }}
          className="text-[10px] text-stone-400 dark:text-neutral-500 truncate hover:text-brand cursor-pointer"
        >
          {task.featureName}
        </button>
        <div className="flex-1" />
        {task.points != null && (
          <span className="text-[10px] font-medium text-stone-400 dark:text-neutral-500 bg-stone-100 dark:bg-dark-overlay px-1.5 py-0.5 rounded shrink-0">
            {task.points}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Tasks View ────────────────────────────────────────────────────────

interface TasksViewProps {
  allTasks: SubIssueWithFeature[] | undefined;
  tasksLoading: boolean;
  sprintFeatures: Feature[];
  people: Person[] | undefined;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  selectedPersons: string[];
  setSelectedPersons: (p: string[]) => void;
  personPills: { login: string; name: string }[];
}

function TasksView({
  allTasks, tasksLoading, sprintFeatures, people, searchQuery, setSearchQuery,
  selectedPersons, setSelectedPersons,
  personPills,
}: TasksViewProps) {
  const [viewMode, setViewMode] = useState<SubViewMode>("board");

  const featureMap = useMemo(() => {
    const m = new Map<number, Feature>();
    for (const f of sprintFeatures) m.set(f.id, f);
    return m;
  }, [sprintFeatures]);

  const filteredTasks = useMemo(
    () => filterTasks(allTasks ?? [], searchQuery, selectedPersons),
    [allTasks, searchQuery, selectedPersons],
  );

  const taskColumns = useMemo(() => {
    const result: Record<TaskStatus, SubIssueWithFeature[]> = { plan: [], in_progress: [], demo: [], tested: [], production: [] };
    for (const t of filteredTasks) result[classifyTask(t, featureMap.get(t.featureId)?.status)].push(t);
    return result;
  }, [filteredTasks, featureMap]);

  const openCount = taskColumns.plan.length + taskColumns.in_progress.length + taskColumns.demo.length;
  const doneCount = taskColumns.tested.length + taskColumns.production.length;

  if (tasksLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Filters + view toggle */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 dark:text-neutral-500" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search tasks..."
            className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-stone-200 dark:border-white/[0.06] bg-white dark:bg-dark-raised text-sm text-stone-700 dark:text-neutral-300 placeholder:text-stone-400 dark:placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
        </div>
        <PersonSelect value={selectedPersons.length > 0 ? selectedPersons : null} onChange={(v) => setSelectedPersons(Array.isArray(v) ? v : v ? [v] : [])} placeholder="All people" multi
          options={personPills.map((p) => ({ value: p.login, label: p.name }))} />
        <ViewToggle value={viewMode} onChange={setViewMode} />
        <div className="text-xs text-stone-400 dark:text-neutral-500 ml-auto">
          {openCount} open · {doneCount} done
        </div>
      </div>

      {/* Board view: 5-column kanban */}
      {viewMode === "board" ? (
        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-3">
          {TASK_COLUMNS.map(({ status, label, color }) => {
            const items = taskColumns[status];
            return (
              <div key={status} className="rounded-xl border border-stone-200 dark:border-white/[0.06] bg-stone-50 dark:bg-dark-base/50">
                <div className="px-3 py-2.5 border-b border-stone-100 dark:border-white/[0.06] bg-white dark:bg-dark-raised rounded-t-xl flex items-center gap-2">
                  <span className={cn("w-2 h-2 rounded-full", color)} />
                  <span className="text-xs font-medium text-stone-700 dark:text-neutral-300">{label}</span>
                  <span className="text-[10px] text-stone-400 dark:text-neutral-500 ml-auto">{items.length}</span>
                </div>
                <div className="p-1.5 pb-2 space-y-1.5 overflow-y-auto max-h-[calc(100vh-260px)]">
                  {items.map((task) => (
                    <TaskKanbanCard key={task.id} task={task} feature={featureMap.get(task.featureId)} />
                  ))}
                  {items.length === 0 && (
                    <div className="px-2 py-6 text-[11px] text-stone-400 dark:text-neutral-500 text-center">—</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* List view: table grouped by status */
        <div className="bg-white dark:bg-dark-raised rounded-xl border border-stone-200 dark:border-white/[0.06] overflow-hidden">
          <div className="grid grid-cols-[1fr_140px_100px_80px_80px_60px] gap-2 px-4 py-2 border-b border-stone-100 dark:border-white/[0.06] text-[10px] uppercase tracking-wider font-medium text-stone-400 dark:text-neutral-500">
            <span>Task</span>
            <span>Feature</span>
            <span>Role</span>
            <span>Assignee</span>
            <span>Status</span>
            <span className="text-right">Pts</span>
          </div>

          {TASK_COLUMNS.map(({ status, label, color }) => {
            const items = taskColumns[status];
            if (items.length === 0) return null;
            const isLate = status === "tested" || status === "production";
            return (
              <div key={status}>
                <div className="px-4 py-1.5 bg-stone-50 dark:bg-dark-overlay border-y border-stone-100 dark:border-white/[0.06] flex items-center gap-1.5">
                  <span className={cn("w-1.5 h-1.5 rounded-full", color)} />
                  <span className={cn("text-[10px] uppercase tracking-wider font-medium", TASK_STATUS_COLORS[status])}>{label} ({items.length})</span>
                </div>
                <div className={cn(isLate && "opacity-60")}>
                  {items.map((task) => (
                    <TaskTableRow key={task.id} task={task} feature={featureMap.get(task.featureId)} statusLabel={label} />
                  ))}
                </div>
              </div>
            );
          })}

          {filteredTasks.length === 0 && (
            <div className="px-4 py-8 text-sm text-stone-400 dark:text-neutral-500 text-center">
              No tasks found. Add roles and tasks to your features to see them here.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TaskKanbanCard({ task, feature }: { task: SubIssueWithFeature; feature?: Feature }) {
  const status = classifyTask(task, feature?.status);
  return (
    <div className={cn(
      "bg-white dark:bg-dark-raised rounded-lg border border-stone-200 dark:border-white/[0.06] p-2.5 shadow-sm",
      status === "production" && "opacity-60",
    )}>
      <a href={task.html_url} target="_blank" rel="noopener noreferrer"
        className="text-sm font-medium text-stone-700 dark:text-neutral-300 hover:text-brand leading-snug line-clamp-2 block">
        {task.title}
      </a>
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        {feature && (
          <span className="text-[10px] text-stone-400 dark:text-neutral-500 truncate max-w-[120px]">{feature.title}</span>
        )}
        {task.roleName && (
          <span className="text-[10px] text-brand/70 bg-brand/5 px-1.5 py-0.5 rounded truncate max-w-[100px]">{task.roleName}</span>
        )}
        <div className="flex-1" />
        {task.assignees.length > 0 && (
          <span className="text-[10px] text-stone-400 dark:text-neutral-500">{task.assignees.join(", ")}</span>
        )}
        {task.points != null && (
          <span className="text-[10px] font-medium text-stone-400 dark:text-neutral-500 bg-stone-100 dark:bg-dark-overlay px-1.5 py-0.5 rounded shrink-0">
            {task.points}
          </span>
        )}
      </div>
    </div>
  );
}

function TaskTableRow({ task, feature, statusLabel }: { task: SubIssueWithFeature; feature?: Feature; statusLabel: string }) {
  const status = classifyTask(task, feature?.status);
  return (
    <div className="grid grid-cols-[1fr_140px_100px_80px_80px_60px] gap-2 px-4 py-2 border-b border-stone-50 dark:border-white/[0.03] hover:bg-stone-50 dark:hover:bg-white/[0.03] items-center">
      <div className="flex items-center gap-2 min-w-0">
        <span className={cn("w-2 h-2 rounded-full shrink-0", TASK_STATUS_DOT[status])} />
        <a href={task.html_url} target="_blank" rel="noopener noreferrer" className="text-sm text-stone-700 dark:text-neutral-300 truncate hover:text-brand">
          {task.title}
        </a>
      </div>
      <span className="text-xs text-stone-400 dark:text-neutral-500 truncate">{feature?.title ?? ""}</span>
      <span className="text-xs text-stone-400 dark:text-neutral-500 truncate">{task.roleName ?? "—"}</span>
      <span className="text-xs text-stone-500 dark:text-neutral-400 truncate">{task.assignees.join(", ") || "—"}</span>
      <span className={cn("text-[10px] font-medium", TASK_STATUS_COLORS[status])}>{statusLabel}</span>
      <span className="text-xs text-stone-500 dark:text-neutral-400 text-right font-medium">{task.points ?? "—"}</span>
    </div>
  );
}

// ─── Shared Components ─────────────────────────────────────────────────

function ViewToggle({ value, onChange }: { value: SubViewMode; onChange: (v: SubViewMode) => void }) {
  return (
    <div className="flex items-center bg-stone-100 dark:bg-dark-overlay rounded-lg p-0.5">
      <button
        onClick={() => onChange("board")}
        className={cn(
          "flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md cursor-pointer transition-all",
          value === "board"
            ? "bg-white dark:bg-dark-raised text-stone-700 dark:text-neutral-200 shadow-sm"
            : "text-stone-400 dark:text-neutral-500 hover:text-stone-600 dark:hover:text-neutral-400",
        )}
      >
        <LayoutGrid size={11} />
        Board
      </button>
      <button
        onClick={() => onChange("list")}
        className={cn(
          "flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md cursor-pointer transition-all",
          value === "list"
            ? "bg-white dark:bg-dark-raised text-stone-700 dark:text-neutral-200 shadow-sm"
            : "text-stone-400 dark:text-neutral-500 hover:text-stone-600 dark:hover:text-neutral-400",
        )}
      >
        <List size={11} />
        List
      </button>
    </div>
  );
}

function FilterDropdown({ value, onChange, placeholder, options }: {
  value: string | null;
  onChange: (v: string | null) => void;
  placeholder: string;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="relative">
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="appearance-none pl-3 pr-7 py-1.5 text-xs font-medium rounded-lg border border-stone-200 dark:border-white/[0.06] bg-white dark:bg-dark-overlay text-stone-700 dark:text-neutral-300 cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand/30"
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-1.5">
        <svg className="w-3.5 h-3.5 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </div>
    </div>
  );
}

function MigrationBanner({ legacyCount, isPending, progress, onMigrate, onDismiss }: {
  legacyCount: number; isPending: boolean; progress: { done: number; total: number } | null;
  onMigrate: () => void; onDismiss: () => void;
}) {
  return (
    <div className="bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3 flex items-center gap-3">
      <Upload size={16} className="text-amber-600 dark:text-amber-400 shrink-0" />
      <div className="flex-1">
        <p className="text-sm text-amber-800 dark:text-amber-200">
          {progress
            ? `Migrating features... (${progress.done}/${progress.total})`
            : `${legacyCount} feature${legacyCount === 1 ? "" : "s"} found in D1. Migrate to GitHub Issues?`}
        </p>
      </div>
      {!isPending && (
        <button onClick={onMigrate} className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 cursor-pointer flex items-center gap-1.5">
          <Upload size={12} /> Migrate
        </button>
      )}
      {isPending && <Loader2 size={16} className="text-amber-600 dark:text-amber-400 animate-spin" />}
      {!isPending && (
        <button onClick={onDismiss} className="text-amber-400 hover:text-amber-600 dark:hover:text-amber-300 text-xs cursor-pointer">Dismiss</button>
      )}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function BackfillForm({ sprint: _sprint, features, mergedPRs, closedIssues, allIssues, snapshots: _snapshots, isPending,
  backfillNumber, setBackfillNumber, backfillName, setBackfillName, backfillStart, setBackfillStart,
  backfillEnd, setBackfillEnd, backfillFocus, setBackfillFocus, onSave, onCancel,
}: any) {
  return (
    <div className="bg-white dark:bg-dark-raised rounded-xl border border-stone-200 dark:border-white/[0.06] p-4 space-y-3">
      <h4 className="text-sm font-semibold text-stone-800 dark:text-neutral-200">Backfill Sprint Snapshot</h4>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className="text-xs text-stone-500 dark:text-neutral-400 block mb-1">Sprint #</label>
          <input type="number" min={1} value={backfillNumber} onChange={(e: any) => setBackfillNumber(parseInt(e.target.value) || 1)}
            className="w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-white/[0.06] bg-white dark:bg-dark-overlay text-stone-900 dark:text-neutral-100 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30" />
        </div>
        <div>
          <label className="text-xs text-stone-500 dark:text-neutral-400 block mb-1">Name</label>
          <input type="text" value={backfillName} onChange={(e: any) => setBackfillName(e.target.value)} placeholder="Sprint name..."
            className="w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-white/[0.06] bg-white dark:bg-dark-overlay text-stone-900 dark:text-neutral-100 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30" />
        </div>
        <div>
          <label className="text-xs text-stone-500 dark:text-neutral-400 block mb-1">Start Date</label>
          <input type="date" value={backfillStart} onChange={(e: any) => setBackfillStart(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-white/[0.06] bg-white dark:bg-dark-overlay text-stone-900 dark:text-neutral-100 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30" />
        </div>
        <div>
          <label className="text-xs text-stone-500 dark:text-neutral-400 block mb-1">End Date</label>
          <input type="date" value={backfillEnd} onChange={(e: any) => setBackfillEnd(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-white/[0.06] bg-white dark:bg-dark-overlay text-stone-900 dark:text-neutral-100 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30" />
        </div>
      </div>
      <div>
        <label className="text-xs text-stone-500 dark:text-neutral-400 block mb-1">Focus</label>
        <input type="text" value={backfillFocus} onChange={(e: any) => setBackfillFocus(e.target.value)} placeholder="Sprint focus..."
          className="w-full px-3 py-2 rounded-lg border border-stone-200 dark:border-white/[0.06] bg-white dark:bg-dark-overlay text-stone-900 dark:text-neutral-100 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30" />
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
                featuresCarriedOver: bf.filter((f: Feature) => f.status === "plan" || f.status === "demo").length,
                tasksDone: 0, tasksOpen: 0, totalPoints: 0, donePoints: 0, rolesCompleted: 0, totalRoles: 0,
              },
              features: bf.map((f: Feature) => ({ title: f.title, status: f.status, owners: f.owners })),
              createdAt: new Date().toISOString(),
            };
            onSave(snap);
          }}
          className="px-4 py-2 bg-brand text-white text-sm font-medium rounded-lg hover:bg-brand/90 disabled:opacity-50 cursor-pointer"
        >
          {isPending ? "Saving..." : "Create Snapshot"}
        </button>
        <button onClick={onCancel} className="px-4 py-2 border border-stone-200 dark:border-white/[0.06] text-sm text-stone-600 dark:text-neutral-400 rounded-lg hover:bg-stone-50 dark:hover:bg-white/[0.06] cursor-pointer">Cancel</button>
      </div>
    </div>
  );
}

// ─── Snapshot View ──────────────────────────────────────────────────────

function SnapshotView({ snapshot }: { snapshot: SprintSnapshot }) {
  const { metrics, features: snapshotFeatures } = snapshot;
  const [selectedEngineer, setSelectedEngineer] = useState<string | null>(null);
  const engineers = snapshot.engineers ?? [];

  // Filtered metrics when engineer is selected
  const eng = selectedEngineer ? engineers.find((e) => e.login === selectedEngineer) : null;
  const m = eng
    ? { ...metrics, prsMerged: eng.prsMerged, issuesClosed: eng.issuesClosed, tasksDone: eng.tasksDone, tasksOpen: eng.tasksOpen, donePoints: eng.points }
    : metrics;

  const totalTasks = m.tasksDone + m.tasksOpen;
  const completionPct = totalTasks > 0 ? Math.round((m.tasksDone / totalTasks) * 100) : 0;
  const pointsPct = m.totalPoints > 0 ? Math.round((m.donePoints / m.totalPoints) * 100) : 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-stone-800 dark:text-neutral-200">
            Sprint {snapshot.sprintNumber}
            {snapshot.name && <span className="text-stone-400 dark:text-neutral-500 font-normal ml-2">— {snapshot.name}</span>}
          </h2>
          <span className="text-xs text-stone-400 dark:text-neutral-500">
            {formatDate(snapshot.startDate)} – {formatDate(snapshot.endDate)}
          </span>
        </div>

        {/* Engineer filter */}
        {engineers.length > 0 && (
          <PersonSelect
            value={selectedEngineer}
            onChange={(v) => setSelectedEngineer(typeof v === "string" ? v : null)}
            options={engineers.map((e) => ({ value: e.login, label: e.login }))}
            placeholder="All Engineers"
          />
        )}
      </div>

      {snapshot.focus && <p className="text-sm text-brand">{snapshot.focus}</p>}

      {/* Top-level metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {([
          ["Features Shipped", metrics.featuresCompleted, "text-green-600 dark:text-green-400"],
          ["Carried Over", metrics.featuresCarriedOver, "text-amber-600 dark:text-amber-400"],
          ["Tasks Done", m.tasksDone, "text-green-600 dark:text-green-400"],
          ["Tasks Open", m.tasksOpen, "text-red-500"],
          ["Roles Done", metrics.rolesCompleted ?? 0, "text-green-600 dark:text-green-400"],
          ["PRs Merged", m.prsMerged, "text-brand"],
          ["Issues Closed", m.issuesClosed, "text-purple-600 dark:text-purple-400"],
          ["Issues Created", metrics.issuesCreated, "text-stone-600 dark:text-neutral-300"],
        ] as const).map(([label, value, color]) => (
          <div key={label} className="bg-white dark:bg-dark-raised rounded-xl border border-stone-200 dark:border-white/[0.06] px-3 py-3 text-center">
            <div className={cn("text-2xl font-semibold", color)}>{value}</div>
            <div className="text-[10px] text-stone-400 dark:text-neutral-500 uppercase tracking-wider mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Progress bars */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Task completion */}
        <div className="bg-white dark:bg-dark-raised rounded-xl border border-stone-200 dark:border-white/[0.06] p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-medium text-stone-400 dark:text-neutral-500 uppercase tracking-wider">Task Completion</h3>
            <span className="text-sm font-semibold text-stone-700 dark:text-neutral-200">{completionPct}%</span>
          </div>
          <div className="h-3 bg-stone-100 dark:bg-white/[0.06] rounded-full overflow-hidden">
            <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${completionPct}%` }} />
          </div>
          <div className="flex items-center gap-4 mt-2 text-xs text-stone-400 dark:text-neutral-500">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> Done {m.tasksDone}</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-stone-300 dark:bg-neutral-600" /> Open {m.tasksOpen}</span>
          </div>
        </div>

        {/* Points progress */}
        <div className="bg-white dark:bg-dark-raised rounded-xl border border-stone-200 dark:border-white/[0.06] p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-medium text-stone-400 dark:text-neutral-500 uppercase tracking-wider">Points Delivered</h3>
            <span className="text-sm font-semibold text-stone-700 dark:text-neutral-200">{m.donePoints}/{m.totalPoints}</span>
          </div>
          <div className="h-3 bg-stone-100 dark:bg-white/[0.06] rounded-full overflow-hidden">
            <div className="h-full bg-brand rounded-full transition-all" style={{ width: `${pointsPct}%` }} />
          </div>
          <div className="flex items-center gap-4 mt-2 text-xs text-stone-400 dark:text-neutral-500">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-brand" /> Completed {m.donePoints}pts</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-stone-300 dark:bg-neutral-600" /> Remaining {m.totalPoints - m.donePoints}pts</span>
          </div>
        </div>
      </div>

      {/* Engineer breakdown */}
      {engineers.length > 0 && !selectedEngineer && (
        <div className="bg-white dark:bg-dark-raised rounded-xl border border-stone-200 dark:border-white/[0.06] p-4">
          <h3 className="text-xs font-medium text-stone-400 dark:text-neutral-500 uppercase tracking-wider mb-3">Engineer Breakdown</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-stone-400 dark:text-neutral-500 uppercase tracking-wider">
                  <th className="pb-2 pr-4 font-medium">Engineer</th>
                  <th className="pb-2 pr-4 font-medium text-center">Tasks Done</th>
                  <th className="pb-2 pr-4 font-medium text-center">Tasks Open</th>
                  <th className="pb-2 pr-4 font-medium text-center">Points</th>
                  <th className="pb-2 pr-4 font-medium text-center">PRs Merged</th>
                  <th className="pb-2 font-medium text-center">Issues Closed</th>
                </tr>
              </thead>
              <tbody>
                {engineers
                  .sort((a, b) => b.tasksDone - a.tasksDone)
                  .map((e) => {
                    const engTotal = e.tasksDone + e.tasksOpen;
                    const engPct = engTotal > 0 ? Math.round((e.tasksDone / engTotal) * 100) : 0;
                    return (
                      <tr
                        key={e.login}
                        onClick={() => setSelectedEngineer(e.login)}
                        className="border-t border-stone-100 dark:border-white/[0.06] hover:bg-stone-50 dark:hover:bg-white/[0.04] cursor-pointer"
                      >
                        <td className="py-2 pr-4">
                          <div className="flex items-center gap-2">
                            <span className="text-stone-700 dark:text-neutral-300 font-medium">{e.login}</span>
                            <div className="flex-1 max-w-[80px] h-1.5 bg-stone-100 dark:bg-white/[0.06] rounded-full overflow-hidden">
                              <div className="h-full bg-green-500 rounded-full" style={{ width: `${engPct}%` }} />
                            </div>
                          </div>
                        </td>
                        <td className="py-2 pr-4 text-center text-green-600 dark:text-green-400 font-medium">{e.tasksDone}</td>
                        <td className="py-2 pr-4 text-center text-stone-500 dark:text-neutral-400">{e.tasksOpen}</td>
                        <td className="py-2 pr-4 text-center text-brand font-medium">{e.points}</td>
                        <td className="py-2 pr-4 text-center text-stone-600 dark:text-neutral-300">{e.prsMerged}</td>
                        <td className="py-2 text-center text-stone-600 dark:text-neutral-300">{e.issuesClosed}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Burndown / velocity chart (bar chart showing done vs open) */}
      {engineers.length > 0 && !selectedEngineer && (
        <div className="bg-white dark:bg-dark-raised rounded-xl border border-stone-200 dark:border-white/[0.06] p-4">
          <h3 className="text-xs font-medium text-stone-400 dark:text-neutral-500 uppercase tracking-wider mb-3">Tasks by Engineer</h3>
          <div className="space-y-2.5">
            {engineers
              .sort((a, b) => (b.tasksDone + b.tasksOpen) - (a.tasksDone + a.tasksOpen))
              .map((e) => {
                const total = e.tasksDone + e.tasksOpen;
                const maxTotal = Math.max(...engineers.map((x) => x.tasksDone + x.tasksOpen), 1);
                return (
                  <div key={e.login} className="flex items-center gap-3">
                    <span className="text-xs text-stone-600 dark:text-neutral-400 w-24 truncate shrink-0">{e.login}</span>
                    <div className="flex-1 flex h-5 rounded overflow-hidden bg-stone-100 dark:bg-white/[0.06]">
                      <div
                        className="bg-green-500 h-full transition-all flex items-center justify-center"
                        style={{ width: `${(e.tasksDone / maxTotal) * 100}%` }}
                      >
                        {e.tasksDone > 0 && <span className="text-[10px] text-white font-medium px-1">{e.tasksDone}</span>}
                      </div>
                      <div
                        className="bg-red-400 h-full transition-all flex items-center justify-center"
                        style={{ width: `${(e.tasksOpen / maxTotal) * 100}%` }}
                      >
                        {e.tasksOpen > 0 && <span className="text-[10px] text-white font-medium px-1">{e.tasksOpen}</span>}
                      </div>
                    </div>
                    <span className="text-xs text-stone-400 dark:text-neutral-500 w-8 text-right shrink-0">{total}</span>
                  </div>
                );
              })}
            <div className="flex items-center gap-4 mt-1 text-xs text-stone-400 dark:text-neutral-500">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> Done</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400" /> Open</span>
            </div>
          </div>
        </div>
      )}

      {/* Features */}
      {snapshotFeatures.length > 0 && (
        <div className="bg-white dark:bg-dark-raised rounded-xl border border-stone-200 dark:border-white/[0.06] p-4">
          <h3 className="text-xs font-medium text-stone-400 dark:text-neutral-500 uppercase tracking-wider mb-3">Features</h3>
          <div className="space-y-2">
            {snapshotFeatures.map((f, i) => (
              <div key={i} className="flex items-center gap-2.5">
                <span className={cn(
                  "w-2.5 h-2.5 rounded-full shrink-0",
                  f.status === "production" ? "bg-green-500" : f.status === "demo" ? "bg-amber-500" : "bg-stone-300",
                )} />
                <span className="text-sm text-stone-700 dark:text-neutral-300">{f.title}</span>
                {f.owners.length > 0 && (
                  <span className="text-xs text-stone-400 dark:text-neutral-500 ml-auto shrink-0">{f.owners.join(", ")}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Personal Todos Completed */}
      {snapshot.todosCompleted && snapshot.todosCompleted.length > 0 && (
        <div className="bg-white dark:bg-dark-raised rounded-xl border border-stone-200 dark:border-white/[0.06] p-4">
          <h3 className="text-xs font-medium text-stone-400 dark:text-neutral-500 uppercase tracking-wider mb-3">
            Personal Todos Completed ({snapshot.todosCompleted.length})
          </h3>
          <div className="space-y-2">
            {snapshot.todosCompleted.map((t, i) => (
              <div key={i} className="flex items-center gap-2.5">
                <span className="w-2.5 h-2.5 rounded-full shrink-0 bg-green-500" />
                <span className="text-sm text-stone-700 dark:text-neutral-300">{t.title}</span>
                <span className="text-xs text-stone-400 dark:text-neutral-500 ml-auto shrink-0">
                  {t.owner} · {formatDate(t.closedAt)}
                </span>
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
