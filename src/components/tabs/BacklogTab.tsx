import { useMemo, useState } from "react";
import { useSprint, useFeatures, usePeople, useSettings, useSaveFeatures } from "@/hooks/useConfigRepo";
import { FeatureCard } from "@/components/sprint/FeatureCard";
import { FeatureDetailModal } from "@/components/sprint/FeatureDetailModal";
import { AddFeatureInput } from "@/components/sprint/AddFeatureInput";
import type { Feature } from "@/lib/types";
import { Archive } from "lucide-react";

export function BacklogTab() {
  const { data: sprint } = useSprint();
  const { data: features } = useFeatures();
  const { data: people } = usePeople();
  const { data: settings } = useSettings();
  const saveFeatures = useSaveFeatures();
  const [detailFeature, setDetailFeature] = useState<Feature | null>(null);

  const teams = useMemo(
    () => settings?.teams ?? [{ name: "Team", color: "#1B6971", repos: [] }],
    [settings],
  );

  const allPeopleNames = useMemo(
    () => (people ?? []).map((p) => p.github),
    [people],
  );

  const futureFeatures = useMemo(
    () => (features ?? []).filter((f) => f.status === "future"),
    [features],
  );

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

  const addFeature = (team: string, title: string) => {
    const all = features ?? [];
    const newFeature: Feature = {
      id: `feat-${Date.now()}`,
      title,
      team,
      owners: [],
      status: "future",
      sprint: null,
      effort: "medium",
    };
    saveFeatures.mutate([...all, newFeature]);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Archive className="w-5 h-5 text-stone-400" />
        <div>
          <h2 className="text-lg font-semibold text-stone-800">Backlog</h2>
          <p className="text-sm text-stone-500">
            Future features — {futureFeatures.length} total
          </p>
        </div>
      </div>

      {/* Per-team sections */}
      {teams.map((team) => {
        const teamFeatures = futureFeatures.filter((f) => f.team === team.name);
        const teamPeople = (people ?? [])
          .filter((p) => p.teams?.includes(team.name))
          .map((p) => p.github);

        return (
          <div key={team.name}>
            <div className="flex items-center gap-2 mb-3">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: team.color }}
              />
              <h3 className="text-sm font-semibold text-stone-700">{team.name}</h3>
              <span className="text-xs text-stone-400">{teamFeatures.length} features</span>
            </div>

            <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
              <div className="p-2 space-y-0.5">
                {teamFeatures.map((feature) => (
                  <FeatureCard
                    key={feature.id}
                    feature={feature}
                    allPeople={teamPeople.length > 0 ? teamPeople : allPeopleNames}
                    onUpdate={updateFeature}
                    onDelete={deleteFeature}
                    onOpenDetail={setDetailFeature}
                    mode="backlog"
                    currentSprint={sprint?.number}
                  />
                ))}
                {teamFeatures.length === 0 && (
                  <div className="px-3 py-4 text-sm text-stone-400 text-center">
                    No backlog features
                  </div>
                )}
                <div className="px-2">
                  <AddFeatureInput onAdd={(title) => addFeature(team.name, title)} />
                </div>
              </div>
            </div>
          </div>
        );
      })}

      {/* Detail modal — rendered at tab level so team changes don't unmount it */}
      {detailFeature && (
        <FeatureDetailModal
          key={detailFeature.id}
          feature={detailFeature}
          allPeople={allPeopleNames}
          allTeams={teams}
          onClose={() => setDetailFeature(null)}
          onUpdate={updateFeature}
        />
      )}
    </div>
  );
}
