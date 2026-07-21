import { useMemo, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { SpecFeatureSidebar, type SidebarSelection } from "@/components/specs/SpecFeatureSidebar";
import { SpecListPane } from "@/components/specs/SpecListPane";
import { SpecDetailModal } from "@/components/specs/SpecDetailModal";
import { SpecEditorForm } from "@/components/specs/SpecEditorForm";
import { PersonSelect } from "@/components/ui/PersonSelect";
import { useSpecs } from "@/hooks/useSpecs";
import { useFeatures } from "@/hooks/useConfigRepo";
import { useActiveMembers } from "@/hooks/useGitHub";
import type { Spec } from "@/lib/types";

// URL params:
//   ?tab=specs                        — default (All specs)
//   ?tab=specs&feature=<n>            — a specific feature's specs
//   ?tab=specs&feature=unfiled        — specs with no feature
//   ?tab=specs&feature=archive        — archived specs
//   ?tab=specs&spec=<id>              — open detail modal for that spec
//   ?tab=specs&person=<login>         — filter to features owned by that login

function parseSelection(raw: string | null): SidebarSelection {
  if (raw === "unfiled") return { kind: "unfiled" };
  if (raw === "archive") return { kind: "archive" };
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return { kind: "feature", featureNumber: n };
  }
  return { kind: "all" };
}

function selectionToParam(sel: SidebarSelection): string | null {
  switch (sel.kind) {
    case "all":
      return null;
    case "unfiled":
      return "unfiled";
    case "archive":
      return "archive";
    case "feature":
      return String(sel.featureNumber);
  }
}

export function SpecsTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selection = parseSelection(searchParams.get("feature"));
  const specParam = searchParams.get("spec");
  const openSpecId = specParam && Number.isFinite(Number(specParam)) ? Number(specParam) : null;

  const [createOpen, setCreateOpen] = useState(false);

  const personFilter = searchParams.get("person") ?? "";
  const setPersonFilter = useCallback(
    (login: string | null) => {
      const params = new URLSearchParams(searchParams);
      if (login) params.set("person", login);
      else params.delete("person");
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );
  const { data: members } = useActiveMembers();

  // Fetch every active + archived spec once — the sidebar needs counts across
  // all buckets, and the list pane is a client-side filter over that same set.
  const specsQ = useSpecs({ featureNumber: "all", includeArchived: true });
  const allSpecs = useMemo<Spec[]>(() => specsQ.data ?? [], [specsQ.data]);

  const { data: features } = useFeatures();
  const featureList = useMemo(() => features ?? [], [features]);
  const featureById = useMemo(() => {
    const m = new Map<number, (typeof featureList)[number]>();
    featureList.forEach((f) => m.set(f.id, f));
    return m;
  }, [featureList]);

  const setSelection = useCallback(
    (next: SidebarSelection) => {
      const params = new URLSearchParams(searchParams);
      params.set("tab", "specs");
      const p = selectionToParam(next);
      if (p) params.set("feature", p);
      else params.delete("feature");
      params.delete("spec");
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const openSpec = useCallback(
    (id: number | null) => {
      const params = new URLSearchParams(searchParams);
      if (id) params.set("spec", String(id));
      else params.delete("spec");
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  // Apply the sidebar selection + person filter client-side. Person filter =
  // only include specs whose owning feature has an owner matching `person`
  // (Features' `owners` array). Unfiled specs never match a person filter.
  const displayedSpecs = useMemo<Spec[]>(() => {
    let list = allSpecs;
    switch (selection.kind) {
      case "archive":
        list = list.filter((s) => s.archived);
        break;
      case "unfiled":
        list = list.filter((s) => !s.archived && s.featureNumber == null);
        break;
      case "feature":
        list = list.filter((s) => !s.archived && s.featureNumber === selection.featureNumber);
        break;
      case "all":
      default:
        list = list.filter((s) => !s.archived);
        break;
    }
    if (personFilter) {
      list = list.filter((s) => {
        if (s.featureNumber == null) return false;
        const f = featureById.get(s.featureNumber);
        return !!f?.owners.includes(personFilter);
      });
    }
    return list;
  }, [allSpecs, selection, personFilter, featureById]);

  const archivedCount = useMemo(() => allSpecs.filter((s) => s.archived).length, [allSpecs]);

  const openSpecObj: Spec | null =
    openSpecId != null ? allSpecs.find((s) => s.id === openSpecId) ?? null : null;

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-semibold text-stone-800">Specs</h1>
          <p className="text-xs text-stone-500 mt-0.5">
            Living notes and design links, grouped by feature.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PersonSelect
            value={personFilter || null}
            onChange={(v) => setPersonFilter(Array.isArray(v) ? v[0] ?? null : v)}
            options={(members ?? []).map((m) => ({ value: m.login, label: m.login }))}
            placeholder="All owners"
          />
          <button
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90 cursor-pointer"
          >
            <Plus size={14} /> New spec
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6">
        <SpecFeatureSidebar
          selection={selection}
          onSelect={setSelection}
          features={featureList}
          specs={allSpecs}
          archivedCount={archivedCount}
        />
        <SpecListPane
          selection={selection}
          features={featureList}
          specs={displayedSpecs}
          loading={specsQ.isLoading}
          onOpen={(spec) => openSpec(spec.id)}
          onCreate={() => setCreateOpen(true)}
        />
      </div>

      {openSpecObj && (
        <SpecDetailModal
          spec={openSpecObj}
          features={featureList}
          onClose={() => openSpec(null)}
        />
      )}

      {createOpen && (
        <SpecEditorForm
          features={featureList}
          initialFeatureNumber={
            selection.kind === "feature" ? selection.featureNumber : null
          }
          onClose={() => setCreateOpen(false)}
          onCreated={(spec) => {
            setCreateOpen(false);
            openSpec(spec.id);
          }}
        />
      )}
    </div>
  );
}
