import { useMemo } from "react";
import { ExternalLink, FileText, Folder, Plus, Archive } from "lucide-react";
import { Spinner } from "@/components/Spinner";
import { cn } from "@/lib/cn";
import type { Spec, SpecFolder } from "@/lib/types";
import type { SidebarSelection } from "./SpecFolderSidebar";

interface Props {
  selection: SidebarSelection;
  folders: SpecFolder[];
  specs: Spec[];
  loading: boolean;
  onOpen: (spec: Spec) => void;
  onCreate: () => void;
}

function headerLabel(selection: SidebarSelection, folders: SpecFolder[]): string {
  switch (selection.kind) {
    case "all":
      return "All specs";
    case "unfiled":
      return "Unfiled";
    case "archive":
      return "Archive";
    case "folder": {
      const f = folders.find((x) => x.id === selection.folderId);
      return f?.name ?? "Project";
    }
  }
}

export function SpecListPane({ selection, folders, specs, loading, onOpen, onCreate }: Props) {
  const folderById = useMemo(() => {
    const map = new Map<number, SpecFolder>();
    folders.forEach((f) => map.set(f.id, f));
    return map;
  }, [folders]);

  const label = headerLabel(selection, folders);

  return (
    <section className="min-w-0">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-stone-700 flex items-center gap-2">
          {selection.kind === "archive" ? (
            <Archive size={14} className="text-stone-400" />
          ) : selection.kind === "folder" ? (
            <Folder size={14} className="text-stone-400" />
          ) : (
            <FileText size={14} className="text-stone-400" />
          )}
          {label}
          <span className="text-xs text-stone-400 font-normal">
            ({specs.length})
          </span>
        </h2>
      </div>

      {loading && !specs.length && (
        <div className="flex items-center justify-center py-16">
          <Spinner className="w-5 h-5 text-accent" />
        </div>
      )}

      {!loading && !specs.length && (
        <div className="rounded-xl border border-dashed border-stone-200 bg-white/50 px-6 py-12 text-center">
          <p className="text-sm text-stone-500 mb-3">
            {selection.kind === "archive"
              ? "Nothing archived yet."
              : "No specs here yet."}
          </p>
          {selection.kind !== "archive" && (
            <button
              onClick={onCreate}
              className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-600 hover:border-accent hover:text-accent cursor-pointer"
            >
              <Plus size={12} /> New spec
            </button>
          )}
        </div>
      )}

      {specs.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {specs.map((s) => (
            <SpecCard
              key={s.id}
              spec={s}
              folder={s.folderId != null ? folderById.get(s.folderId) ?? null : null}
              showFolder={selection.kind === "all" || selection.kind === "archive"}
              onClick={() => onOpen(s)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

interface SpecCardProps {
  spec: Spec;
  folder: SpecFolder | null;
  showFolder: boolean;
  onClick: () => void;
}

function SpecCard({ spec, folder, showFolder, onClick }: SpecCardProps) {
  const linkCount = spec.links.length;
  const description = spec.description.trim();

  return (
    <button
      onClick={onClick}
      className={cn(
        "text-left rounded-xl border border-stone-200 bg-white p-4 hover:border-accent hover:shadow-sm transition-all cursor-pointer flex flex-col gap-2 min-h-[120px]",
        spec.archived && "opacity-70",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium text-stone-800 line-clamp-2">
          {spec.title || <span className="text-stone-400">Untitled</span>}
        </h3>
        {spec.archived && (
          <span className="shrink-0 text-[10px] uppercase tracking-wider text-stone-400 border border-stone-200 rounded-full px-1.5 py-0.5">
            Archived
          </span>
        )}
      </div>
      {description ? (
        <p className="text-xs text-stone-500 line-clamp-2 whitespace-pre-line">
          {description}
        </p>
      ) : (
        <p className="text-xs text-stone-300 italic">No description</p>
      )}
      <div className="flex items-center gap-3 mt-auto text-[11px] text-stone-400">
        {showFolder && (
          <span className="inline-flex items-center gap-1 truncate">
            {folder ? (
              <>
                <Folder size={11} /> {folder.name}
              </>
            ) : (
              <>
                <FileText size={11} /> Unfiled
              </>
            )}
          </span>
        )}
        {linkCount > 0 && (
          <span className="inline-flex items-center gap-1">
            <ExternalLink size={11} /> {linkCount} link{linkCount === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </button>
  );
}
