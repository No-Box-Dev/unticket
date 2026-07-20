import { useMemo, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { SpecFolderSidebar, type SidebarSelection } from "@/components/specs/SpecFolderSidebar";
import { SpecListPane } from "@/components/specs/SpecListPane";
import { SpecDetailModal } from "@/components/specs/SpecDetailModal";
import { SpecEditorForm } from "@/components/specs/SpecEditorForm";
import { PersonSelect } from "@/components/ui/PersonSelect";
import { useSpecFolders, useSpecs } from "@/hooks/useSpecs";
import { useActiveMembers } from "@/hooks/useGitHub";
import type { Spec, SpecFolder } from "@/lib/types";

// URL params:
//   ?tab=specs                     — default view (All specs)
//   ?tab=specs&folder=<id>         — a specific project
//   ?tab=specs&folder=unfiled      — Unfiled
//   ?tab=specs&folder=archive      — Archive section (folder list + specs)
//   ?tab=specs&spec=<id>           — open detail modal for that spec

function parseSelection(raw: string | null): SidebarSelection {
  if (raw === "unfiled") return { kind: "unfiled" };
  if (raw === "archive") return { kind: "archive" };
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return { kind: "folder", folderId: n };
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
    case "folder":
      return String(sel.folderId);
  }
}

export function SpecsTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selection = parseSelection(searchParams.get("folder"));
  const specParam = searchParams.get("spec");
  const openSpecId = specParam && Number.isFinite(Number(specParam)) ? Number(specParam) : null;

  const [createOpen, setCreateOpen] = useState(false);
  // Person filter: matches the spec's project owner. Unfiled specs and
  // specs in projects with no owner are excluded when this filter is on
  // — matches Features' "owner-driven" filter behavior.
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

  // Folder list — always fetch both variants so the sidebar can render
  // "Archive (n)" counts without a second click. Two separate queries keeps
  // the TanStack cache invalidation semantics simple; they hit different keys.
  const activeFoldersQ = useSpecFolders({ includeArchived: false });
  const allFoldersQ = useSpecFolders({ includeArchived: true });

  // Specs — the pane subscribes to whatever slice matches the current sidebar
  // selection. `useSpecs` is a thin wrapper over the API list endpoint.
  const specsFilter = useMemo(() => {
    switch (selection.kind) {
      case "all":
        return { folderId: "all" as const };
      case "unfiled":
        return { folderId: "unfiled" as const };
      case "folder":
        return { folderId: selection.folderId };
      case "archive":
        return { includeArchived: true };
    }
  }, [selection]);
  const specsQ = useSpecs(specsFilter);

  const setSelection = useCallback(
    (next: SidebarSelection) => {
      const params = new URLSearchParams(searchParams);
      params.set("tab", "specs");
      const p = selectionToParam(next);
      if (p) params.set("folder", p);
      else params.delete("folder");
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

  const activeFolders: SpecFolder[] = activeFoldersQ.data ?? [];
  const allFolders: SpecFolder[] = useMemo(
    () => allFoldersQ.data ?? [],
    [allFoldersQ.data],
  );
  const archivedFolders = allFolders.filter((f) => f.archived);

  // Person filter: keep only specs whose project (folder) is owned by the
  // selected login. Specs with no folder (Unfiled) OR whose folder has no
  // owner drop out when the filter is on. This matches "specs someone owns"
  // more accurately than filtering by created_by.
  const ownerByFolderId = useMemo(() => {
    const m = new Map<number, string | null>();
    allFolders.forEach((f) => m.set(f.id, f.owner));
    return m;
  }, [allFolders]);

  // For the Archive view, filter down to archived rows client-side. The API
  // returned everything for that scope (include=all with no folderId).
  const displayedSpecs = useMemo<Spec[]>(() => {
    let list = specsQ.data ?? [];
    if (selection.kind === "archive") list = list.filter((s) => s.archived);
    else list = list.filter((s) => !s.archived);
    if (personFilter) {
      list = list.filter((s) => {
        if (s.folderId == null) return false;
        return ownerByFolderId.get(s.folderId) === personFilter;
      });
    }
    return list;
  }, [specsQ.data, selection, personFilter, ownerByFolderId]);

  // Unfiled spec count for the sidebar. Only cheap when the active folders
  // query already loaded the full active-spec set — otherwise fall back to a
  // derived count from the current pane if it happens to be the "All" view.
  const activeSpecsForCountsQ = useSpecs({ folderId: "all" });
  const unfiledActiveCount = (activeSpecsForCountsQ.data ?? []).filter(
    (s) => !s.archived && s.folderId === null,
  ).length;
  const allActiveCount = (activeSpecsForCountsQ.data ?? []).filter((s) => !s.archived).length;

  const openSpecObj: Spec | null =
    openSpecId != null ? displayedSpecs.find((s) => s.id === openSpecId) ?? null : null;

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-semibold text-stone-800">Specs</h1>
          <p className="text-xs text-stone-500 mt-0.5">
            Living notes and design links, grouped by project. Fully manual — nothing here
            comes from GitHub.
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
        <SpecFolderSidebar
          selection={selection}
          onSelect={setSelection}
          activeFolders={activeFolders}
          archivedFolders={archivedFolders}
          unfiledCount={unfiledActiveCount}
          allActiveCount={allActiveCount}
        />
        <SpecListPane
          selection={selection}
          folders={allFolders}
          specs={displayedSpecs}
          loading={specsQ.isLoading}
          onOpen={(spec) => openSpec(spec.id)}
          onCreate={() => setCreateOpen(true)}
        />
      </div>

      {openSpecObj && (
        <SpecDetailModal
          spec={openSpecObj}
          folders={allFolders}
          onClose={() => openSpec(null)}
        />
      )}

      {createOpen && (
        <SpecEditorForm
          folders={activeFolders}
          initialFolderId={
            selection.kind === "folder" ? selection.folderId : null
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
