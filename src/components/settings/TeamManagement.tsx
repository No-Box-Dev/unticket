import { useState, useEffect } from "react";
import { Plus, Pencil, Trash2, X, Check, Search } from "lucide-react";
import type { OrgSettings, Team, RepoInfo } from "@/lib/types";
import type { UseMutationResult } from "@tanstack/react-query";

const PRESET_COLORS = [
  "#1B6971",
  "#2563EB",
  "#7C3AED",
  "#DB2777",
  "#EA580C",
  "#16A34A",
  "#CA8A04",
  "#64748B",
];

interface Props {
  settings: OrgSettings;
  saveSettings: UseMutationResult<void, Error, OrgSettings>;
  repos: RepoInfo[];
}

export function TeamManagement({ settings, saveSettings, repos }: Props) {
  const [addingTeam, setAddingTeam] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  const [editRepos, setEditRepos] = useState<string[]>([]);
  const [repoSearch, setRepoSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const teams = settings.teams;

  // Build map of repo -> team name (excluding the team being edited)
  const repoToTeam = new Map<string, string>();
  teams.forEach((t, i) => {
    if (i === editingIndex) return; // skip edited team — use editRepos instead
    t.repos.forEach((r) => repoToTeam.set(r, t.name));
  });

  const unassignedRepos = repos.filter((r) => {
    if (editingIndex !== null && editRepos.includes(r.name)) return false;
    return !repoToTeam.has(r.name);
  });

  function persist(nextTeams: Team[]) {
    saveSettings.mutate({ ...settings, teams: nextTeams });
  }

  function handleAdd() {
    const trimmed = newName.trim();
    if (!trimmed || teams.some((t) => t.name === trimmed)) return;
    persist([...teams, { name: trimmed, color: newColor, repos: [] }]);
    setNewName("");
    setNewColor(PRESET_COLORS[0]);
    setAddingTeam(false);
  }

  function startEdit(index: number) {
    setEditingIndex(index);
    setEditName(teams[index].name);
    setEditColor(teams[index].color);
    setEditRepos([...teams[index].repos]);
    setRepoSearch("");
    setConfirmDelete(null);
  }

  function cancelEdit() {
    setEditingIndex(null);
    setRepoSearch("");
  }

  function handleSaveEdit() {
    if (editingIndex === null) return;
    const trimmed = editName.trim();
    if (!trimmed) return;
    const isDuplicate = teams.some(
      (t, i) => i !== editingIndex && t.name === trimmed,
    );
    if (isDuplicate) return;

    const next = teams.map((t, i) =>
      i === editingIndex ? { ...t, name: trimmed, color: editColor, repos: editRepos } : t,
    );
    persist(next);
    setEditingIndex(null);
  }

  function toggleRepo(repoName: string) {
    setEditRepos((prev) =>
      prev.includes(repoName)
        ? prev.filter((r) => r !== repoName)
        : [...prev, repoName],
    );
  }

  function handleDelete(index: number) {
    persist(teams.filter((_, i) => i !== index));
    setConfirmDelete(null);
    if (editingIndex === index) setEditingIndex(null);
  }

  const nameValid =
    newName.trim().length > 0 &&
    !teams.some((t) => t.name === newName.trim());

  const filteredRepos =
    repoSearch.trim().length > 0
      ? repos.filter((r) =>
          r.name.toLowerCase().includes(repoSearch.toLowerCase()),
        )
      : repos;

  return (
    <div className="bg-white rounded-xl border border-stone-200 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-stone-900">Teams</h2>
        {!addingTeam && (
          <button
            onClick={() => {
              setAddingTeam(true);
              if (editingIndex !== null) handleSaveEdit();
              setConfirmDelete(null);
            }}
            className="flex items-center gap-1 text-xs text-teal-700 hover:text-teal-900 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Team
          </button>
        )}
      </div>

      {/* Add Team Inline Form */}
      {addingTeam && (
        <div className="border border-stone-200 rounded-lg p-3 space-y-3 bg-stone-50">
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && nameValid) handleAdd();
                if (e.key === "Escape") setAddingTeam(false);
              }}
              placeholder="Team name..."
              className="flex-1 text-sm border border-stone-200 rounded-lg px-2.5 py-1 focus:outline-none focus:border-teal-600"
            />
            <button
              onClick={handleAdd}
              disabled={!nameValid}
              className="text-xs font-medium text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-40 px-3 py-1 rounded-lg cursor-pointer disabled:cursor-default"
            >
              Add
            </button>
            <button
              onClick={() => setAddingTeam(false)}
              className="text-stone-400 hover:text-stone-600 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <ColorPicker value={newColor} onChange={setNewColor} />
        </div>
      )}

      {/* Team List */}
      {teams.length === 0 && !addingTeam && (
        <p className="text-xs text-stone-400">
          No teams yet. Add a team to organize repos.
        </p>
      )}

      <div className="space-y-2">
        {teams.map((team, i) => {
          const displayRepos = editingIndex === i ? editRepos : team.repos;

          return (
            <div key={i} className="border border-stone-200 rounded-lg overflow-hidden">
              {/* Team Row */}
              <div className="flex items-center gap-3 px-3 py-2.5">
                <div
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: editingIndex === i ? editColor : team.color }}
                />
                <span className="text-sm font-medium text-stone-800 flex-1">
                  {editingIndex === i ? editName || team.name : team.name}
                </span>
                <span className="text-xs text-stone-400 tabular-nums">
                  {displayRepos.length} repo{displayRepos.length !== 1 && "s"}
                </span>
                {editingIndex !== i && confirmDelete !== i && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => startEdit(i)}
                      className="p-1 text-stone-400 hover:text-stone-600 cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        setConfirmDelete(i);
                        if (editingIndex !== null) handleSaveEdit();
                      }}
                      className="p-1 text-stone-400 hover:text-red-500 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                {confirmDelete === i && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-red-500">Delete?</span>
                    <button
                      onClick={() => handleDelete(i)}
                      className="text-xs text-red-600 font-medium hover:text-red-800 cursor-pointer"
                    >
                      Yes
                    </button>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="text-xs text-stone-400 hover:text-stone-600 cursor-pointer"
                    >
                      No
                    </button>
                  </div>
                )}
              </div>

              {/* Edit Panel */}
              {editingIndex === i && (
                <div className="border-t border-stone-200 bg-stone-50 p-3 space-y-3">
                  <div className="flex items-center gap-2">
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveEdit();
                        if (e.key === "Escape") cancelEdit();
                      }}
                      className="flex-1 text-sm border border-stone-200 rounded-lg px-2.5 py-1 focus:outline-none focus:border-teal-600"
                    />
                    <button
                      onClick={handleSaveEdit}
                      className="p-1 text-teal-700 hover:text-teal-900 cursor-pointer"
                      title="Save"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="p-1 text-stone-400 hover:text-stone-600 cursor-pointer"
                      title="Cancel"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <ColorPicker value={editColor} onChange={setEditColor} />

                  {/* Repo Assignment */}
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-stone-600">
                      Assign Repositories
                    </div>
                    {repos.length > 15 && (
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-stone-400" />
                        <input
                          value={repoSearch}
                          onChange={(e) => setRepoSearch(e.target.value)}
                          placeholder="Search repos..."
                          className="w-full text-xs border border-stone-200 rounded-lg pl-7 pr-2 py-1 focus:outline-none focus:border-teal-600"
                        />
                      </div>
                    )}
                    <div className="max-h-48 overflow-y-auto space-y-0.5">
                      {filteredRepos.map((repo) => {
                        const assignedTo = repoToTeam.get(repo.name);
                        const isOurs = editRepos.includes(repo.name);
                        const isOther = !!assignedTo;

                        return (
                          <label
                            key={repo.id}
                            className={`flex items-center gap-2 px-2 py-1 rounded text-xs ${
                              isOther
                                ? "text-stone-300 cursor-default"
                                : "text-stone-600 hover:bg-stone-100 cursor-pointer"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isOurs}
                              disabled={isOther}
                              onChange={() => toggleRepo(repo.name)}
                              className="accent-teal-700"
                            />
                            <span>{repo.name}</span>
                            {isOther && (
                              <span className="text-stone-300 ml-auto">
                                (assigned to {assignedTo})
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Unassigned repos summary */}
      {unassignedRepos.length > 0 && teams.length > 0 && (
        <div className="pt-2 border-t border-stone-100">
          <div className="text-xs text-stone-400">
            <span className="font-medium text-stone-500">
              {unassignedRepos.length} unassigned
            </span>{" "}
            — {unassignedRepos.map((r) => r.name).join(", ")}
          </div>
        </div>
      )}
    </div>
  );
}

function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (c: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {PRESET_COLORS.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className={`w-5 h-5 rounded-full cursor-pointer ring-offset-1 ${
            value === c ? "ring-2 ring-stone-400" : ""
          }`}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  );
}
