import { useState, useRef, useEffect } from "react";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Inbox,
  Layers,
  MoreHorizontal,
  Pencil,
  Undo2,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useIsAdmin } from "@/hooks/useGitHub";
import { useConfirm, ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useSetSpecFolderArchived, useUpdateSpecFolder } from "@/hooks/useSpecs";
import type { SpecFolder } from "@/lib/types";
import { FolderCreateInline } from "./FolderCreateInline";

export type SidebarSelection =
  | { kind: "all" }
  | { kind: "unfiled" }
  | { kind: "folder"; folderId: number }
  | { kind: "archive" };

interface Props {
  selection: SidebarSelection;
  onSelect: (sel: SidebarSelection) => void;
  activeFolders: SpecFolder[];
  archivedFolders: SpecFolder[];
  unfiledCount: number;
  allActiveCount: number;
}

export function SpecFolderSidebar({
  selection,
  onSelect,
  activeFolders,
  archivedFolders,
  unfiledCount,
  allActiveCount,
}: Props) {
  const [archiveOpen, setArchiveOpen] = useState(selection.kind === "archive");
  const [renaming, setRenaming] = useState<number | null>(null);
  const isAdmin = useIsAdmin();
  const { confirm, dialogProps } = useConfirm();
  const setArchivedMut = useSetSpecFolderArchived();

  const isActive = (sel: SidebarSelection) => {
    if (selection.kind !== sel.kind) return false;
    if (selection.kind === "folder" && sel.kind === "folder") {
      return selection.folderId === sel.folderId;
    }
    return true;
  };

  return (
    <aside className="space-y-4">
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 px-2 mb-1">
          Overview
        </div>
        <ul className="space-y-0.5">
          <SidebarItem
            active={isActive({ kind: "all" })}
            onClick={() => onSelect({ kind: "all" })}
            icon={<Layers size={14} />}
            label="All specs"
            count={allActiveCount}
          />
          <SidebarItem
            active={isActive({ kind: "unfiled" })}
            onClick={() => onSelect({ kind: "unfiled" })}
            icon={<Inbox size={14} />}
            label="Unfiled"
            count={unfiledCount}
          />
        </ul>
      </div>

      <div>
        <div className="flex items-center justify-between px-2 mb-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">
            Projects
          </span>
        </div>
        <ul className="space-y-0.5">
          {activeFolders.map((f) =>
            renaming === f.id ? (
              <li key={f.id}>
                <RenameFolderInline folder={f} onDone={() => setRenaming(null)} />
              </li>
            ) : (
              <FolderRow
                key={f.id}
                folder={f}
                active={isActive({ kind: "folder", folderId: f.id })}
                onSelect={() => onSelect({ kind: "folder", folderId: f.id })}
                isAdmin={isAdmin}
                onRename={() => setRenaming(f.id)}
                onArchive={async () => {
                  const ok = await confirm({
                    title: `Archive "${f.name}"?`,
                    message:
                      f.specCount > 0
                        ? `This will also archive ${f.specCount} spec${f.specCount === 1 ? "" : "s"} in this project. You can restore each one individually later.`
                        : "You can restore this project from the Archive section later.",
                    confirmLabel: "Archive",
                    variant: "danger",
                  });
                  if (ok) setArchivedMut.mutate({ id: f.id, archived: true });
                }}
              />
            ),
          )}
          <li>
            <FolderCreateInline />
          </li>
        </ul>
      </div>

      {archivedFolders.length > 0 || archiveOpen ? (
        <div>
          <button
            onClick={() => {
              const next = !archiveOpen;
              setArchiveOpen(next);
              if (next && selection.kind !== "archive") onSelect({ kind: "archive" });
            }}
            className="w-full flex items-center gap-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-stone-400 hover:text-stone-600 cursor-pointer"
          >
            {archiveOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <Archive size={12} />
            Archive
            {archivedFolders.length > 0 && (
              <span className="ml-1 text-stone-400">({archivedFolders.length})</span>
            )}
          </button>
          {archiveOpen && (
            <ul className="mt-1 space-y-0.5">
              <SidebarItem
                active={isActive({ kind: "archive" })}
                onClick={() => onSelect({ kind: "archive" })}
                icon={<Archive size={14} />}
                label="Archived specs"
              />
              {archivedFolders.map((f) => (
                <ArchivedFolderRow
                  key={f.id}
                  folder={f}
                  isAdmin={isAdmin}
                  onRestore={() =>
                    setArchivedMut.mutate({ id: f.id, archived: false })
                  }
                />
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <ConfirmDialog {...dialogProps} />
    </aside>
  );
}

// ---------- Sub-components ----------

interface SidebarItemProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
}

function SidebarItem({ active, onClick, icon, label, count }: SidebarItemProps) {
  return (
    <li>
      <button
        onClick={onClick}
        className={cn(
          "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-left cursor-pointer",
          active
            ? "bg-accent/10 text-accent font-medium"
            : "text-stone-600 hover:bg-stone-100",
        )}
      >
        <span className="shrink-0">{icon}</span>
        <span className="flex-1 truncate">{label}</span>
        {count !== undefined && count > 0 && (
          <span className="text-[10px] text-stone-400">{count}</span>
        )}
      </button>
    </li>
  );
}

interface FolderRowProps {
  folder: SpecFolder;
  active: boolean;
  onSelect: () => void;
  isAdmin: boolean;
  onRename: () => void;
  onArchive: () => void;
}

function FolderRow({ folder, active, onSelect, isAdmin, onRename, onArchive }: FolderRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  return (
    <li className="group relative">
      <button
        onClick={onSelect}
        className={cn(
          "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-left cursor-pointer",
          active
            ? "bg-accent/10 text-accent font-medium"
            : "text-stone-600 hover:bg-stone-100",
        )}
      >
        {active ? <FolderOpen size={14} /> : <Folder size={14} />}
        <span className="flex-1 truncate">{folder.name}</span>
        {folder.specCount > 0 && (
          <span className="text-[10px] text-stone-400">{folder.specCount}</span>
        )}
      </button>
      {isAdmin && (
        <div className="absolute right-1 top-1/2 -translate-y-1/2" ref={menuRef}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-stone-200 text-stone-500 cursor-pointer"
            title="Project options"
            aria-label="Project options"
          >
            <MoreHorizontal size={12} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 bg-white border border-stone-200 rounded-lg shadow-md py-1 min-w-[160px] z-40">
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onRename();
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-stone-600 hover:bg-stone-50 cursor-pointer"
              >
                <Pencil size={12} /> Rename
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onArchive();
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 cursor-pointer"
              >
                <Archive size={12} /> Archive project
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function ArchivedFolderRow({
  folder,
  isAdmin,
  onRestore,
}: {
  folder: SpecFolder;
  isAdmin: boolean;
  onRestore: () => void;
}) {
  return (
    <li className="group flex items-center gap-1 px-2 py-1 rounded-md text-xs text-stone-500">
      <Folder size={12} className="text-stone-400" />
      <span className="flex-1 truncate italic">{folder.name}</span>
      {isAdmin && (
        <button
          onClick={onRestore}
          className="p-0.5 opacity-0 group-hover:opacity-100 text-stone-500 hover:text-accent cursor-pointer"
          title="Restore project"
          aria-label="Restore project"
        >
          <Undo2 size={12} />
        </button>
      )}
    </li>
  );
}

function RenameFolderInline({ folder, onDone }: { folder: SpecFolder; onDone: () => void }) {
  const [value, setValue] = useState(folder.name);
  const updateMut = useUpdateSpecFolder();

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || trimmed === folder.name) {
      onDone();
      return;
    }
    updateMut.mutate({ id: folder.id, name: trimmed }, { onSettled: onDone });
  }

  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={submit}
      onKeyDown={(e) => {
        if (e.key === "Enter") submit();
        if (e.key === "Escape") onDone();
      }}
      className="w-full px-2 py-1.5 rounded-md border border-accent bg-white text-xs text-stone-700 focus:outline-none"
    />
  );
}

