import { useState } from "react";
import { X, UserRound } from "lucide-react";
import { useActiveMembers } from "@/hooks/useGitHub";
import { cn } from "@/lib/cn";
import { useUpdateSpecFolder } from "@/hooks/useSpecs";
import type { SpecFolder } from "@/lib/types";

interface Props {
  folder: SpecFolder;
  onClose: () => void;
}

// Modal for setting/clearing a project's owner. Any authenticated org member
// can edit — the backend PATCH endpoint isn't admin-gated (only /archive is).
// Search filters against login. "No owner" restores the null state.
export function FolderOwnerModal({ folder, onClose }: Props) {
  const { data: members } = useActiveMembers();
  const updateMut = useUpdateSpecFolder();
  const [search, setSearch] = useState("");

  const filtered = (members ?? []).filter((m) => {
    if (!search.trim()) return true;
    return m.login.toLowerCase().includes(search.toLowerCase());
  });

  function pick(login: string | null) {
    updateMut.mutate({ id: folder.id, owner: login });
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-stone-100">
          <div>
            <h3 className="text-sm font-semibold text-stone-800">Project owner</h3>
            <p className="text-xs text-stone-500 mt-0.5">{folder.name}</p>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-stone-100">
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search members…"
            className="w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700 focus:outline-none focus:border-accent"
          />
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          <button
            onClick={() => pick(null)}
            className={cn(
              "w-full flex items-center gap-3 px-5 py-2 text-left cursor-pointer hover:bg-stone-50",
              folder.owner === null && "bg-accent/5",
            )}
          >
            <div className="w-7 h-7 rounded-full bg-stone-100 border border-stone-200 flex items-center justify-center text-stone-400">
              <UserRound size={14} />
            </div>
            <span className="text-sm text-stone-600">No owner</span>
          </button>

          {filtered.length === 0 && members !== undefined && (
            <div className="px-5 py-6 text-center text-xs text-stone-400">
              {members.length === 0 ? "No members loaded." : "No matches."}
            </div>
          )}

          {filtered.map((m) => (
            <button
              key={m.login}
              onClick={() => pick(m.login)}
              className={cn(
                "w-full flex items-center gap-3 px-5 py-2 text-left cursor-pointer hover:bg-stone-50",
                folder.owner === m.login && "bg-accent/5",
              )}
            >
              {m.avatar_url ? (
                <img
                  src={m.avatar_url}
                  alt=""
                  className="w-7 h-7 rounded-full shrink-0"
                />
              ) : (
                <div className="w-7 h-7 rounded-full bg-stone-100 border border-stone-200 flex items-center justify-center text-[10px] text-stone-500 shrink-0">
                  {m.login.slice(0, 1).toUpperCase()}
                </div>
              )}
              <span className="text-sm text-stone-700 truncate">{m.login}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
