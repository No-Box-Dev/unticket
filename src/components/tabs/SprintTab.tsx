import { useMemo } from "react";
import { useSprint, useFeatures, usePeople, useSettings, useSaveFeatures, useCreateConfigRepo } from "@/hooks/useConfigRepo";
import { useOpenIssues, useClosedIssues } from "@/hooks/useGitHub";
import { FeatureCard } from "@/components/sprint/FeatureCard";
import { AddFeatureInput } from "@/components/sprint/AddFeatureInput";
import { SprintIssuesTable } from "@/components/sprint/SprintIssuesTable";
import type { Feature } from "@/lib/types";
import { Calendar, Rocket } from "lucide-react";

interface SprintTabProps {
  repoNames: string[];
}

export function SprintTab({ repoNames }: SprintTabProps) {
  const { data: sprint, isLoading: sprintLoading } = useSprint();
  const { data: features } = useFeatures();
  const { data: people } = usePeople();
  const { data: settings } = useSettings();
  const saveFeatures = useSaveFeatures();
  const createRepo = useCreateConfigRepo();

  const since = sprint?.startDate;
  const { data: openIssues, isLoading: issuesLoading } = useOpenIssues(repoNames);
  const { data: closedIssues } = useClosedIssues(repoNames, since);

  const teams = useMemo(
    () => settings?.teams ?? [{ name: "Team", color: "#1B6971" }],
    [settings],
  );

  const allPeopleNames = useMemo(
    () => (people ?? []).map((p) => p.github),
    [people],
  );

  const sprintFeatures = useMemo(
    () =>
      (features ?? []).filter(
        (f) => f.sprint === sprint?.number && f.status !== "future",
      ),
    [features, sprint],
  );

  const updateFeature = (updated: Feature) => {
    const all = features ?? [];
    const next = all.map((f) => (f.id === updated.id ? updated : f));
    saveFeatures.mutate(next);
  };

  const deleteFeature = (id: string) => {
    const all = features ?? [];
    saveFeatures.mutate(all.filter((f) => f.id !== id));
  };

  const addFeature = (team: string, title: string) => {
    const all = features ?? [];
    const newFeature: Feature = {
      id: `feat-${Date.now()}`,
      title,
      team,
      owners: [],
      status: "active",
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
      <div className="bg-white rounded-xl border border-stone-200 border-l-4 border-l-brand p-5">
        <h2 className="text-lg font-semibold text-stone-800">
          Sprint {sprint.number}: {sprint.name}
        </h2>
        <div className="flex items-center gap-2 mt-1 text-sm text-stone-500">
          <Calendar className="w-4 h-4" />
          {formatDate(sprint.startDate)} — {formatDate(sprint.endDate)}
        </div>
        {sprint.focus && (
          <p className="mt-2 text-sm text-stone-600">{sprint.focus}</p>
        )}
      </div>

      {/* Per-team sections */}
      {teams.map((team) => {
        const teamFeatures = sprintFeatures.filter((f) => f.team === team.name);
        const doneCount = teamFeatures.filter((f) => f.status === "done").length;
        const teamPeople = (people ?? [])
          .filter((p) => p.team === team.name)
          .map((p) => p.github);

        // Filter issues by team members
        const teamOpenIssues = (openIssues ?? [])
          .map((i: any) => ({ ...i, repo: i.head?.repo?.name ?? i.repository?.name ?? "" }))
          .filter(() => true); // Show all issues for now
        const teamClosedIssues = (closedIssues ?? [])
          .map((i: any) => ({ ...i }))
          .filter(() => true);

        return (
          <div key={team.name}>
            <div
              className="flex items-center gap-2 mb-3"
            >
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: team.color }}
              />
              <h3 className="text-sm font-semibold text-stone-700">{team.name}</h3>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Features Panel */}
              <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-stone-100">
                  <span className="text-sm font-medium text-stone-700">
                    Features{" "}
                    <span className="text-stone-400 font-normal">
                      {doneCount}/{teamFeatures.length}
                    </span>
                  </span>
                </div>
                <div className="p-2 space-y-0.5">
                  {teamFeatures.map((feature) => (
                    <FeatureCard
                      key={feature.id}
                      feature={feature}
                      allPeople={teamPeople.length > 0 ? teamPeople : allPeopleNames}
                      onUpdate={updateFeature}
                      onDelete={deleteFeature}
                      mode="sprint"
                    />
                  ))}
                  {teamFeatures.length === 0 && (
                    <div className="px-3 py-4 text-sm text-stone-400 text-center">
                      No features for this sprint
                    </div>
                  )}
                  <div className="px-2">
                    <AddFeatureInput onAdd={(title) => addFeature(team.name, title)} />
                  </div>
                </div>
              </div>

              {/* Issues Panel */}
              <SprintIssuesTable
                openIssues={teamOpenIssues as any}
                closedIssues={teamClosedIssues as any}
                isLoading={issuesLoading}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
