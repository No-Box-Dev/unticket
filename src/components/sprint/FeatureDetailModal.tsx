import { useState, useRef, useEffect, useCallback } from "react";
import { X, ExternalLink, FileText, Pencil, Save, Loader2 } from "lucide-react";
import { EffortTag } from "./EffortTag";
import { PriorityTag } from "./PriorityTag";
import { AssignDropdown } from "./AssignDropdown";
import { useAuth } from "@/lib/auth";
import { fetchPlanFile, planFilePath, savePlanFile } from "@/lib/config-repo";
import type { Feature, Effort, Priority } from "@/lib/types";

interface FeatureDetailModalProps {
  feature: Feature;
  allPeople: string[];
  onClose: () => void;
  onUpdate: (updated: Feature) => void;
}

export function FeatureDetailModal({ feature, allPeople, onClose, onUpdate }: FeatureDetailModalProps) {
  const { selectedOrg } = useAuth();

  const [draft, setDraft] = useState<Feature>({ ...feature });
  const [plan, setPlan] = useState<string | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const save = useCallback((next: Feature) => {
    onUpdate({ ...next });
  }, [onUpdate]);

  const saveDebounced = useCallback((next: Feature) => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => save(next), 500);
  }, [save]);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  function update(patch: Partial<Feature>, debounce = false) {
    setDraft((d) => {
      const next = { ...d, ...patch };
      if (debounce) {
        saveDebounced(next);
      } else {
        clearTimeout(debounceRef.current);
        save(next);
      }
      return next;
    });
  }

  // Load plan from .gitpulse repo on mount
  useEffect(() => {
    if (!selectedOrg) {
      setPlan(null);
      return;
    }
    setPlanLoading(true);
    fetchPlanFile(selectedOrg, draft.id)
      .then((result) => setPlan(result?.content ?? null))
      .catch(() => setPlan(null))
      .finally(() => setPlanLoading(false));
  }, [selectedOrg, draft.id]);

  function handleClose() {
    clearTimeout(debounceRef.current);
    onUpdate({ ...draft });
    onClose();
  }

  const planUrl = selectedOrg
    ? `https://github.com/${selectedOrg}/.gitpulse/blob/main/${planFilePath(draft.id)}`
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={handleClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-3xl mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
          <input
            value={draft.title}
            onChange={(e) => update({ title: e.target.value }, true)}
            className="text-lg font-semibold text-stone-800 bg-transparent border-none outline-none focus:ring-0 w-full"
          />
          <button onClick={handleClose} className="text-stone-400 hover:text-stone-600 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-5">
          <div className="flex items-center gap-4">
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

          {/* Implementation Plan */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-stone-500">Implementation Plan</span>
              <div className="flex items-center gap-2">
                {planUrl && plan !== null && (
                  <a
                    href={planUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-stone-400 hover:text-brand flex items-center gap-1"
                    title="View on GitHub"
                  >
                    <ExternalLink size={12} />
                  </a>
                )}
                {!planLoading && !editMode && plan !== null && (
                  <button
                    onClick={() => { setEditContent(plan); setEditMode(true); setSaveError(null); }}
                    className="text-xs text-stone-400 hover:text-brand flex items-center gap-1 cursor-pointer"
                  >
                    <Pencil size={12} />
                    Edit
                  </button>
                )}
              </div>
            </div>

            {planLoading && (
              <div className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-8 text-center text-sm text-stone-400">
                Loading plan...
              </div>
            )}

            {!planLoading && !editMode && plan === null && (
              <div className="rounded-lg border border-dashed border-stone-200 bg-stone-50 px-4 py-8 text-center text-sm text-stone-400">
                <FileText size={20} className="mx-auto mb-2 text-stone-300" />
                No plan found.
                <br />
                <button
                  onClick={() => { setEditContent(""); setEditMode(true); setSaveError(null); }}
                  className="mt-2 px-3 py-1.5 rounded-md bg-brand text-white text-xs font-medium hover:bg-brand/90 cursor-pointer"
                >
                  Create Plan
                </button>
              </div>
            )}

            {!planLoading && !editMode && plan !== null && (
              <pre className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700 font-mono whitespace-pre-wrap overflow-y-auto max-h-[50vh]">
                {plan}
              </pre>
            )}

            {editMode && (
              <div className="space-y-2">
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm text-stone-700 font-mono whitespace-pre-wrap focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand resize-y min-h-[200px] max-h-[50vh]"
                  rows={12}
                />
                {saveError && (
                  <p className="text-xs text-red-500">{saveError}</p>
                )}
                <div className="flex items-center gap-2">
                  <button
                    onClick={async () => {
                      if (!selectedOrg) return;
                      setSaving(true);
                      setSaveError(null);
                      try {
                        await savePlanFile(selectedOrg, draft.id, editContent);
                        setPlan(editContent);
                        setEditMode(false);
                      } catch (err) {
                        setSaveError(err instanceof Error ? err.message : "Failed to save plan");
                      } finally {
                        setSaving(false);
                      }
                    }}
                    disabled={saving}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-brand text-white text-xs font-medium hover:bg-brand/90 disabled:opacity-50 cursor-pointer"
                  >
                    {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                    {saving ? "Saving..." : "Save & Sync"}
                  </button>
                  <button
                    onClick={() => { setEditMode(false); setSaveError(null); }}
                    disabled={saving}
                    className="px-3 py-1.5 rounded-md border border-stone-200 text-xs text-stone-600 hover:bg-stone-50 disabled:opacity-50 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 text-[10px] text-stone-400 pt-1">
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ${
                draft.status === "production"
                  ? "bg-green-500"
                  : draft.status === "demo"
                    ? "bg-amber-500"
                    : draft.status === "plan"
                      ? "bg-brand"
                      : "bg-stone-300"
              }`}
            />
            {draft.status === "production" ? "Production" : draft.status === "demo" ? "Demo" : draft.status === "plan" ? "Plan" : "Future"}
          </div>
        </div>
      </div>
    </div>
  );
}
