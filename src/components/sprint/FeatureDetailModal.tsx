import { useState, useRef, useEffect, useCallback } from "react";
import { X, Plus, Trash2 } from "lucide-react";
import { EffortTag } from "./EffortTag";
import { PriorityTag } from "./PriorityTag";
import { AssignDropdown } from "./AssignDropdown";
import type { Feature, Effort, Priority, Team, Spec } from "@/lib/types";

// Normalize legacy string specs to Spec objects
function normalizeSpecs(specs?: (string | Spec)[]): Spec[] {
  if (!specs) return [];
  return specs.map((s) => (typeof s === "string" ? { text: s } : s));
}

function cleanFeature(draft: Feature, specs: Spec[]): Feature {
  const cleanedSpecs = specs
    .filter((s) => s.text.trim().length > 0)
    .map((s) => (s.owner ? s : { text: s.text }));
  return {
    ...draft,
    description: draft.description?.trim() || undefined,
    specs: cleanedSpecs.length > 0 ? cleanedSpecs : undefined,
  };
}

interface FeatureDetailModalProps {
  feature: Feature;
  allPeople: string[];
  allTeams: Team[];
  onClose: () => void;
  onUpdate: (updated: Feature) => void;
}

export function FeatureDetailModal({ feature, allPeople, allTeams, onClose, onUpdate }: FeatureDetailModalProps) {
  const [draft, setDraft] = useState<Feature>({
    ...feature,
    description: feature.description ?? "",
    specs: normalizeSpecs(feature.specs),
  });
  const [newSpec, setNewSpec] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const specs = normalizeSpecs(draft.specs);

  // Auto-save: immediate for discrete changes, debounced for text input
  const save = useCallback((next: Feature, nextSpecs: Spec[]) => {
    onUpdate(cleanFeature(next, nextSpecs));
  }, [onUpdate]);

  const saveDebounced = useCallback((next: Feature, nextSpecs: Spec[]) => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => save(next, nextSpecs), 500);
  }, [save]);

  // Flush any pending debounced save on unmount
  useEffect(() => () => clearTimeout(debounceRef.current), []);

  function update(patch: Partial<Feature>, debounce = false) {
    setDraft((d) => {
      const next = { ...d, ...patch };
      const nextSpecs = normalizeSpecs(next.specs);
      if (debounce) {
        saveDebounced(next, nextSpecs);
      } else {
        clearTimeout(debounceRef.current);
        save(next, nextSpecs);
      }
      return next;
    });
  }

  function handleClose() {
    // Flush any pending debounced save
    clearTimeout(debounceRef.current);
    onUpdate(cleanFeature(draft, specs));
    onClose();
  }

  function addSpec() {
    const trimmed = newSpec.trim();
    if (!trimmed) return;
    update({ specs: [...specs, { text: trimmed }] });
    setNewSpec("");
  }

  function removeSpec(index: number) {
    update({ specs: specs.filter((_, i) => i !== index) });
  }

  function updateSpecText(index: number, text: string) {
    const next = [...specs];
    next[index] = { ...next[index], text };
    update({ specs: next }, true);
  }

  function updateSpecOwner(index: number, owner: string | undefined) {
    const next = [...specs];
    next[index] = { ...next[index], owner };
    update({ specs: next });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={handleClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
          <h2 className="text-lg font-semibold text-stone-800">{draft.title}</h2>
          <button onClick={handleClose} className="text-stone-400 hover:text-stone-600 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-5">
          <div className="flex items-center gap-4">
            <div>
              <span className="text-xs text-stone-500 block mb-1">Team</span>
              <TeamDropdown
                value={draft.team}
                teams={allTeams}
                onChange={(team) => update({ team })}
              />
            </div>
            <div>
              <span className="text-xs text-stone-500 block mb-1">Sprint</span>
              <span className="text-sm text-stone-700">{draft.sprint ?? "Backlog"}</span>
            </div>
            <div>
              <span className="text-xs text-stone-500 block mb-1">Priority</span>
              <PriorityTag
                priority={draft.priority ?? "none"}
                onChange={(priority: Priority) => update({ priority })}
              />
            </div>
            <div>
              <span className="text-xs text-stone-500 block mb-1">Effort</span>
              <EffortTag
                effort={draft.effort}
                onChange={(effort: Effort) => update({ effort })}
              />
            </div>
            <div>
              <span className="text-xs text-stone-500 block mb-1">Owners</span>
              <AssignDropdown
                owners={draft.owners}
                allPeople={allPeople}
                onChange={(owners) => update({ owners })}
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <span className="text-xs text-stone-500 block mb-1.5">Description</span>
            <textarea
              value={draft.description ?? ""}
              onChange={(e) => update({ description: e.target.value }, true)}
              placeholder="Add a description..."
              rows={3}
              className="w-full text-sm text-stone-700 border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-teal-600 resize-none placeholder:text-stone-300"
            />
          </div>

          {/* Specs */}
          <div>
            <span className="text-xs text-stone-500 block mb-2">Specs</span>
            <div className="space-y-3">
              {specs.map((spec, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-xs text-stone-300 w-4 text-right shrink-0 pt-1.5">{i + 1}.</span>
                  <div className="flex-1 space-y-1">
                    <input
                      value={spec.text}
                      onChange={(e) => updateSpecText(i, e.target.value)}
                      className="w-full text-sm text-stone-700 border border-stone-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-teal-600"
                    />
                    <SpecOwnerPicker
                      owner={spec.owner}
                      allPeople={allPeople}
                      onChange={(owner) => updateSpecOwner(i, owner)}
                    />
                  </div>
                  <button
                    onClick={() => removeSpec(i)}
                    className="p-1 text-stone-300 hover:text-red-500 cursor-pointer pt-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <span className="text-xs text-stone-300 w-4 text-right shrink-0">
                  <Plus className="w-3 h-3 inline" />
                </span>
                <input
                  value={newSpec}
                  onChange={(e) => setNewSpec(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addSpec();
                  }}
                  placeholder="Add a spec..."
                  className="flex-1 text-sm text-stone-700 border border-stone-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-teal-600 placeholder:text-stone-300"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 text-[10px] text-stone-400 pt-1">
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ${
                draft.status === "done"
                  ? "bg-green-500"
                  : draft.status === "active"
                    ? "bg-blue-500"
                    : "bg-stone-300"
              }`}
            />
            {draft.status === "done" ? "Completed" : draft.status === "active" ? "Active" : "Future"}
          </div>
        </div>
      </div>
    </div>
  );
}

function SpecOwnerPicker({
  owner,
  allPeople,
  onChange,
}: {
  owner?: string;
  allPeople: string[];
  onChange: (owner: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen(!open)}
        className="text-[11px] cursor-pointer"
      >
        {owner ? (
          <span className="text-stone-500 hover:text-stone-700">{owner}</span>
        ) : (
          <span className="text-stone-300 hover:text-stone-400">+ assign</span>
        )}
      </button>
      {open && (
        <div className="absolute z-20 top-full left-0 mt-1 bg-white border border-stone-200 rounded-lg shadow-lg py-1 min-w-[140px]">
          {owner && (
            <button
              onClick={() => { onChange(undefined); setOpen(false); }}
              className="w-full px-3 py-1.5 text-xs text-stone-400 hover:bg-stone-50 cursor-pointer text-left"
            >
              Unassign
            </button>
          )}
          {allPeople.map((person) => (
            <button
              key={person}
              onClick={() => { onChange(person); setOpen(false); }}
              className={`w-full px-3 py-1.5 text-xs hover:bg-stone-50 cursor-pointer text-left ${
                person === owner ? "font-medium text-stone-800" : "text-stone-600"
              }`}
            >
              {person}
            </button>
          ))}
          {allPeople.length === 0 && (
            <div className="px-3 py-1.5 text-xs text-stone-400">
              No people configured
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TeamDropdown({
  value,
  teams,
  onChange,
}: {
  value: string;
  teams: Team[];
  onChange: (team: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const currentTeam = teams.find((t) => t.name === value);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-sm text-stone-700 hover:text-stone-900 cursor-pointer"
      >
        {currentTeam && (
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: currentTeam.color }}
          />
        )}
        {value}
      </button>
      {open && (
        <div className="absolute z-20 top-full left-0 mt-1 bg-white border border-stone-200 rounded-lg shadow-lg py-1 min-w-[140px]">
          {teams.map((team) => (
            <button
              key={team.name}
              onClick={() => {
                onChange(team.name);
                setOpen(false);
              }}
              className={`flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-stone-50 cursor-pointer text-left ${
                team.name === value ? "font-medium text-stone-800" : "text-stone-600"
              }`}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: team.color }}
              />
              {team.name}
            </button>
          ))}
          {teams.length === 0 && (
            <div className="px-3 py-1.5 text-xs text-stone-400">
              No teams configured
            </div>
          )}
        </div>
      )}
    </div>
  );
}
