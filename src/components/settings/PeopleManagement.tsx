import { useState } from "react";
import { Search, Pencil, Check, X, Plus, Trash2 } from "lucide-react";
import type { Person, Team } from "@/lib/types";
import type { UseMutationResult } from "@tanstack/react-query";

interface Props {
  people: Person[];
  savePeople: UseMutationResult<void, Error, Person[]>;
  teams: Team[];
}

export function PeopleManagement({ people, savePeople, teams }: Props) {
  const [search, setSearch] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState("");
  const [editTeams, setEditTeams] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [newGithub, setNewGithub] = useState("");
  const [newName, setNewName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const filtered = search.trim()
    ? people.filter(
        (p) =>
          p.name.toLowerCase().includes(search.toLowerCase()) ||
          p.github.toLowerCase().includes(search.toLowerCase()) ||
          p.teams.some((t) => t.toLowerCase().includes(search.toLowerCase())),
      )
    : people;

  function persist(next: Person[]) {
    savePeople.mutate(next);
  }

  function startEdit(index: number) {
    const person = people[index];
    setEditingIndex(index);
    setEditName(person.name);
    setEditRole(person.role);
    setEditTeams([...person.teams]);
    setConfirmDelete(null);
  }

  function cancelEdit() {
    setEditingIndex(null);
  }

  function handleSaveEdit() {
    if (editingIndex === null) return;
    const next = people.map((p, i) =>
      i === editingIndex
        ? { ...p, name: editName.trim() || p.github, role: editRole.trim(), teams: editTeams }
        : p,
    );
    persist(next);
    setEditingIndex(null);
  }

  function toggleTeam(teamName: string) {
    setEditTeams((prev) => {
      if (prev.includes(teamName)) return prev.filter((t) => t !== teamName);
      if (prev.length >= 2) return prev;
      return [...prev, teamName];
    });
  }

  function handleAdd() {
    const github = newGithub.trim();
    const name = newName.trim() || github;
    if (!github || people.some((p) => p.github === github)) return;
    persist([...people, { github, name, teams: [], role: "" }]);
    setNewGithub("");
    setNewName("");
    setAdding(false);
  }

  function handleDelete(index: number) {
    persist(people.filter((_, i) => i !== index));
    setConfirmDelete(null);
    if (editingIndex === index) setEditingIndex(null);
  }

  const addValid = newGithub.trim().length > 0 && !people.some((p) => p.github === newGithub.trim());

  return (
    <div className="bg-white rounded-xl border border-stone-200 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-stone-900">People ({people.length})</h2>
        {!adding && (
          <button
            onClick={() => {
              setAdding(true);
              if (editingIndex !== null) handleSaveEdit();
            }}
            className="flex items-center gap-1 text-xs text-teal-700 hover:text-teal-900 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Person
          </button>
        )}
      </div>

      {/* Search */}
      {people.length > 8 && (
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, GitHub, or team..."
            className="w-full text-xs border border-stone-200 rounded-lg pl-7 pr-2 py-1.5 focus:outline-none focus:border-teal-600"
          />
        </div>
      )}

      {/* Add Person Form */}
      {adding && (
        <div className="border border-stone-200 rounded-lg p-3 space-y-2 bg-stone-50">
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={newGithub}
              onChange={(e) => setNewGithub(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && addValid) handleAdd();
                if (e.key === "Escape") setAdding(false);
              }}
              placeholder="GitHub username..."
              className="flex-1 text-sm border border-stone-200 rounded-lg px-2.5 py-1 focus:outline-none focus:border-teal-600"
            />
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && addValid) handleAdd();
                if (e.key === "Escape") setAdding(false);
              }}
              placeholder="Display name..."
              className="flex-1 text-sm border border-stone-200 rounded-lg px-2.5 py-1 focus:outline-none focus:border-teal-600"
            />
            <button
              onClick={handleAdd}
              disabled={!addValid}
              className="text-xs font-medium text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-40 px-3 py-1 rounded-lg cursor-pointer disabled:cursor-default"
            >
              Add
            </button>
            <button
              onClick={() => setAdding(false)}
              className="text-stone-400 hover:text-stone-600 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* People List */}
      <div className="space-y-1">
        {filtered.map((person) => {
          const realIndex = people.indexOf(person);
          const isEditing = editingIndex === realIndex;

          return (
            <div key={person.github} className="border border-stone-200 rounded-lg overflow-hidden">
              {/* Person Row */}
              <div className="flex items-center gap-3 px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-stone-800 truncate">
                      {person.name || person.github}
                    </span>
                    {person.name && person.name !== person.github && (
                      <span className="text-xs text-stone-400 shrink-0">@{person.github}</span>
                    )}
                  </div>
                  {person.role && <div className="text-xs text-stone-400">{person.role}</div>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {person.teams.map((teamName) => {
                    const team = teams.find((t) => t.name === teamName);
                    return (
                      <span
                        key={teamName}
                        className="inline-flex items-center gap-1 text-xs text-stone-500 bg-stone-50 px-1.5 py-0.5 rounded-full"
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ backgroundColor: team?.color ?? "#94a3b8" }}
                        />
                        {teamName}
                      </span>
                    );
                  })}
                  {person.teams.length === 0 && (
                    <span className="text-xs text-stone-300 italic">no team</span>
                  )}
                </div>
                {!isEditing && confirmDelete !== realIndex && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => startEdit(realIndex)}
                      className="p-1 text-stone-400 hover:text-stone-600 cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        setConfirmDelete(realIndex);
                        if (editingIndex !== null) handleSaveEdit();
                      }}
                      className="p-1 text-stone-400 hover:text-red-500 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                {confirmDelete === realIndex && (
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-red-500">Remove?</span>
                    <button
                      onClick={() => handleDelete(realIndex)}
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
              {isEditing && (
                <div className="border-t border-stone-200 bg-stone-50 p-3 space-y-3">
                  <div className="flex items-center gap-2">
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveEdit();
                        if (e.key === "Escape") cancelEdit();
                      }}
                      placeholder="Display name..."
                      className="flex-1 text-sm border border-stone-200 rounded-lg px-2.5 py-1 focus:outline-none focus:border-teal-600"
                    />
                    <input
                      value={editRole}
                      onChange={(e) => setEditRole(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveEdit();
                        if (e.key === "Escape") cancelEdit();
                      }}
                      placeholder="Role..."
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

                  {/* Team Assignment */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-stone-600">Teams</span>
                      <span className="text-xs text-stone-400">(max 2)</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {teams.map((team) => {
                        const selected = editTeams.includes(team.name);
                        const atMax = editTeams.length >= 2 && !selected;
                        return (
                          <button
                            key={team.name}
                            onClick={() => toggleTeam(team.name)}
                            disabled={atMax}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full transition-colors ${
                              selected
                                ? "text-white font-medium cursor-pointer"
                                : atMax
                                  ? "bg-stone-50 text-stone-300 cursor-default"
                                  : "bg-stone-100 text-stone-600 hover:bg-stone-200 cursor-pointer"
                            }`}
                            style={selected ? { backgroundColor: team.color } : undefined}
                          >
                            {!selected && (
                              <span
                                className="w-2 h-2 rounded-full"
                                style={{ backgroundColor: team.color }}
                              />
                            )}
                            {team.name}
                          </button>
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

      {filtered.length === 0 && search && (
        <p className="text-xs text-stone-400 text-center py-2">No people matching &ldquo;{search}&rdquo;</p>
      )}

      {people.length === 0 && !adding && (
        <p className="text-xs text-stone-400">No people configured. Add team members to get started.</p>
      )}
    </div>
  );
}
