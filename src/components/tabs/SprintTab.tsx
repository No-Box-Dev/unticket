import { useMemo, useState } from "react";
import { useSprint, useFeatures, usePeople, useSettings, useSaveFeatures, useCreateConfigRepo } from "@/hooks/useConfigRepo";
import { useOpenIssues, useClosedIssues } from "@/hooks/useGitHub";
import { useAuth } from "@/lib/auth";
import { FeatureCard } from "@/components/sprint/FeatureCard";
import { FeatureDetailModal } from "@/components/sprint/FeatureDetailModal";
import { AddFeatureInput } from "@/components/sprint/AddFeatureInput";
import { SprintIssuesTable } from "@/components/sprint/SprintIssuesTable";
import type { Feature } from "@/lib/types";
import { Calendar, Rocket } from "lucide-react";

interface SprintTabProps {
  repoNames: string[];
}

export function SprintTab({ repoNames }: SprintTabProps) {
  const { user } = useAuth();
  const { data: sprint, isLoading: sprintLoading } = useSprint();
  const { data: features } = useFeatures();
  const { data: people } = usePeople();
  const { data: settings } = useSettings();
  const saveFeatures = useSaveFeatures();
  const createRepo = useCreateConfigRepo();

  const [justMe, setJustMe] = useState(false);
  const [detailFeature, setDetailFeature] = useState<Feature | null>(null);

  const since = sprint?.startDate;
  const { data: openIssues, isLoading: issuesLoading } = useOpenIssues(repoNames);
  const { data: closedIssues } = useClosedIssues(repoNames, since);

  const teams = useMemo(
    () => settings?.teams ?? [{ name: "Team", color: "#1B6971", repos: [] }],
    [settings],
  );

  const draftRepos = useMemo(
    () => new Set(settings?.draftRepos ?? []),
    [settings],
  );

  const allPeopleNames = useMemo(
    () => (people ?? []).map((p) => p.github),
    [people],
  );

  // Flat sprint features (no team grouping)
  const sprintFeatures = useMemo(() => {
    let feats = (features ?? []).filter(
      (f) => f.sprint === sprint?.number && f.status !== "future",
    );
    if (justMe && user) {
      feats = feats.filter((f) => f.owners.includes(user.login));
    }
    return feats;
  }, [features, sprint, justMe, user]);

  const doneCount = useMemo(
    () => sprintFeatures.filter((f) => f.status === "done").length,
    [sprintFeatures],
  );

  // Issues grouped by team, excluding draft repos
  const issuesByTeam = useMemo(() => {
    return teams.map((team) => {
      const teamRepos = (team.repos ?? []).filter((r) => !draftRepos.has(r));
      let teamOpen = (openIssues ?? []).filter((i: any) => teamRepos.includes(i.repo));
      let teamClosed = (closedIssues ?? []).filter((i: any) => teamRepos.includes(i.repo));

      if (justMe && user) {
        teamOpen = teamOpen.filter((i: any) =>
          i.assignees?.some((a: any) => a.login === user.login),
        );
        teamClosed = teamClosed.filter((i: any) =>
          i.assignees?.some((a: any) => a.login === user.login),
        );
      }

      return { team, openIssues: teamOpen, closedIssues: teamClosed };
    }).filter((t) => t.team.repos.length > 0);
  }, [teams, openIssues, closedIssues, draftRepos, justMe, user]);

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
      {/* Sprint Header + Just Me */}
      <div className="bg-white rounded-xl border border-stone-200 border-l-4 border-l-brand px-4 py-2.5">
        <div className="flex items-center justify-between">
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
          <button
            onClick={() => setJustMe(!justMe)}
            className={`px-3 py-1 text-xs font-medium rounded-full cursor-pointer transition-colors ${
              justMe
                ? "bg-brand text-white"
                : "bg-stone-100 text-stone-600 hover:bg-stone-200"
            }`}
          >
            Just Me
          </button>
        </div>
      </div>

      {/* Two-column layout: Features left, Issues right */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Flat feature list */}
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-stone-100">
            <span className="text-sm font-medium text-stone-700">
              Features{" "}
              <span className="text-stone-400 font-normal">
                {doneCount}/{sprintFeatures.length}
              </span>
            </span>
          </div>
          <div className="p-2 space-y-0.5 overflow-y-auto max-h-[600px]">
            {sprintFeatures.map((feature) => (
              <FeatureCard
                key={feature.id}
                feature={feature}
                allPeople={allPeopleNames}
                onUpdate={updateFeature}
                onDelete={deleteFeature}
                onOpenDetail={setDetailFeature}
                mode="sprint"
              />
            ))}
            {sprintFeatures.length === 0 && (
              <div className="px-3 py-4 text-sm text-stone-400 text-center">
                No features for this sprint
              </div>
            )}
            <div className="px-2">
              <AddFeatureInput onAdd={addFeature} />
            </div>
          </div>
        </div>

        {/* Right: Issues organized by team */}
        <div className="space-y-4">
          {issuesByTeam.map(({ team, openIssues: teamOpen, closedIssues: teamClosed }) => (
            <div key={team.name}>
              <div className="flex items-center gap-2 mb-2">
                <div
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: team.color }}
                />
                <h3 className="text-xs font-bold uppercase tracking-wider text-stone-600">
                  {team.name}
                </h3>
              </div>
              <SprintIssuesTable
                openIssues={teamOpen as any}
                closedIssues={teamClosed as any}
                isLoading={issuesLoading}
                sprintStart={sprint.startDate}
              />
            </div>
          ))}
          {issuesByTeam.length === 0 && (
            <div className="bg-white rounded-xl border border-stone-200 px-4 py-8 text-sm text-stone-400 text-center">
              No teams have repos assigned
            </div>
          )}
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
