import { useState } from "react";
import { Search, Pencil, Check, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Person, OrgSettings } from "@/lib/types";
import type { UseMutationResult } from "@tanstack/react-query";

interface OrgMember {
  login: string;
  avatar_url: string;
}

interface Props {
  people: Person[];
  savePeople: UseMutationResult<void, Error, Person[]>;
  orgMembers: OrgMember[];
  settings: OrgSettings;
  saveSettings: UseMutationResult<void, Error, OrgSettings>;
}

export function PeopleManagement({ people, savePeople, orgMembers, settings, saveSettings }: Props) {
  const [search, setSearch] = useState("");
  const [editingLogin, setEditingLogin] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState("");
  const excluded = new Set(settings.excludedMembers ?? []);
  const peopleMap = new Map(people.map((p) => [p.github, p]));

  // Merge org members with people config
  const members = orgMembers.map((m) => {
    const person = peopleMap.get(m.login);
    return {
      login: m.login,
      avatar_url: m.avatar_url,
      name: person?.name ?? m.login,
      role: person?.role ?? "",
      active: !excluded.has(m.login),
    };
  });

  const filtered = search.trim()
    ? members.filter(
        (m) =>
          m.name.toLowerCase().includes(search.toLowerCase()) ||
          m.login.toLowerCase().includes(search.toLowerCase()) ||
          m.role.toLowerCase().includes(search.toLowerCase()),
      )
    : members;

  const activeCount = members.filter((m) => m.active).length;

  function toggleMember(login: string) {
    const current = settings.excludedMembers ?? [];
    const next = excluded.has(login)
      ? current.filter((l) => l !== login)
      : [...current, login];
    saveSettings.mutate({ ...settings, excludedMembers: next });
  }

  function startEdit(login: string) {
    const m = members.find((m) => m.login === login);
    if (!m) return;
    setEditingLogin(login);
    setEditName(m.name === m.login ? "" : m.name);
    setEditRole(m.role);
  }

  function cancelEdit() {
    setEditingLogin(null);
  }

  function handleSaveEdit() {
    if (!editingLogin) return;
    const existing = peopleMap.get(editingLogin);
    const updated: Person = {
      github: editingLogin,
      name: editName.trim() || editingLogin,
      role: editRole.trim(),
    };
    const next = existing
      ? people.map((p) => (p.github === editingLogin ? updated : p))
      : [...people, updated];
    savePeople.mutate(next);
    setEditingLogin(null);
  }

  return (
    <div className="bg-white dark:bg-dark-raised rounded-xl border border-stone-200 dark:border-white/[0.06] p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-stone-900 dark:text-neutral-100">
          People ({activeCount}/{members.length})
        </h2>
        <span className="text-xs text-stone-400 dark:text-neutral-500">
          Deselect to hide from platform
        </span>
      </div>

      {/* Search */}
      {members.length > 8 && (
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 dark:text-neutral-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, GitHub, or role..."
            className="w-full text-xs border border-stone-200 dark:border-white/[0.06] rounded-lg pl-7 pr-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand/30 dark:bg-dark-overlay dark:text-neutral-100"
          />
        </div>
      )}

      {/* Members List */}
      <div className="space-y-1 max-h-[500px] overflow-y-auto">
        {filtered.map((member) => {
          const isEditing = editingLogin === member.login;

          return (
            <div
              key={member.login}
              className={cn(
                "border rounded-lg overflow-hidden transition-colors",
                member.active
                  ? "border-stone-200 dark:border-white/[0.06]"
                  : "border-stone-100 dark:border-white/[0.03] opacity-50",
              )}
            >
              {/* Member Row */}
              <div className="flex items-center gap-3 px-3 py-2">
                {/* Toggle checkbox */}
                <input
                  type="checkbox"
                  checked={member.active}
                  onChange={() => toggleMember(member.login)}
                  className="rounded border-stone-300 dark:border-white/[0.1] text-brand focus:ring-brand/30 shrink-0 cursor-pointer"
                />

                {/* Avatar */}
                <img
                  src={member.avatar_url}
                  alt={member.login}
                  className="w-7 h-7 rounded-full shrink-0"
                />

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-stone-800 dark:text-neutral-200 truncate">
                      {member.name}
                    </span>
                    {member.name !== member.login && (
                      <span className="text-xs text-stone-400 dark:text-neutral-500 shrink-0">@{member.login}</span>
                    )}
                  </div>
                  {member.role && <div className="text-xs text-stone-400 dark:text-neutral-500">{member.role}</div>}
                </div>

                {/* Edit button */}
                {member.active && !isEditing && (
                  <button
                    onClick={() => startEdit(member.login)}
                    className="p-1 text-stone-400 dark:text-neutral-500 hover:text-stone-600 dark:hover:text-neutral-400 cursor-pointer shrink-0"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Edit Panel */}
              {isEditing && (
                <div className="border-t border-stone-200 dark:border-white/[0.06] bg-stone-50 dark:bg-white/[0.04] p-3 space-y-3">
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveEdit();
                        if (e.key === "Escape") cancelEdit();
                      }}
                      placeholder="Display name..."
                      className="flex-1 text-sm border border-stone-200 dark:border-white/[0.06] rounded-lg px-2.5 py-1 focus:outline-none focus:ring-2 focus:ring-brand/30 dark:bg-dark-overlay dark:text-neutral-100"
                    />
                    <input
                      value={editRole}
                      onChange={(e) => setEditRole(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveEdit();
                        if (e.key === "Escape") cancelEdit();
                      }}
                      placeholder="Role..."
                      className="flex-1 text-sm border border-stone-200 dark:border-white/[0.06] rounded-lg px-2.5 py-1 focus:outline-none focus:ring-2 focus:ring-brand/30 dark:bg-dark-overlay dark:text-neutral-100"
                    />
                    <button
                      onClick={handleSaveEdit}
                      className="p-1 text-brand hover:text-brand/80 cursor-pointer"
                      title="Save"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="p-1 text-stone-400 dark:text-neutral-500 hover:text-stone-600 dark:hover:text-neutral-400 cursor-pointer"
                      title="Cancel"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                </div>
              )}
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && search && (
        <p className="text-xs text-stone-400 dark:text-neutral-500 text-center py-2">No people matching &ldquo;{search}&rdquo;</p>
      )}

      {members.length === 0 && (
        <p className="text-xs text-stone-400 dark:text-neutral-500">No organisation members found. Make sure members are added to your GitHub organisation.</p>
      )}
    </div>
  );
}
