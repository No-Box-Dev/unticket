import { useState, useMemo } from "react";
import { X, Lock, Loader2 } from "lucide-react";
import type { SprintConfig, Feature } from "@/lib/types";

interface SprintOption {
  value: number;
  label: string;
}

interface NewSprintModalProps {
  currentSprint: SprintConfig;
  features: Feature[];
  /** Existing sprints the user can move features to */
  targetOptions: SprintOption[];
  onConfirm: (newSprint: SprintConfig) => void;
  onClose: () => void;
  isPending: boolean;
  failedCount?: number;
}

export function NewSprintModal({ currentSprint, features, targetOptions, onConfirm, onClose, isPending, failedCount }: NewSprintModalProps) {
  const nextNumber = currentSprint.number + 1;

  // Compute default dates: start = day after current end, same duration
  const currentStart = new Date(currentSprint.startDate);
  const currentEnd = new Date(currentSprint.endDate);
  const durationMs = currentEnd.getTime() - currentStart.getTime();
  const defaultStart = new Date(currentEnd.getTime() + 86400000); // +1 day
  const defaultEnd = new Date(defaultStart.getTime() + durationMs);

  // Target sprint selector: existing options + "new sprint"
  const NEW_SPRINT = -1;
  const defaultTarget = targetOptions.length > 0 ? targetOptions[0].value : NEW_SPRINT;
  const [targetSprint, setTargetSprint] = useState<number>(defaultTarget);
  const isNewSprint = targetSprint === NEW_SPRINT;

  // New sprint form fields (only used when creating new)
  const [newNumber, setNewNumber] = useState(nextNumber);
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState(toDateStr(defaultStart));
  const [endDate, setEndDate] = useState(toDateStr(defaultEnd));
  const [focus, setFocus] = useState("");

  const sprintFeatures = useMemo(
    () => features.filter((f) => f.sprint === currentSprint.number && f.status !== "future"),
    [features, currentSprint.number],
  );

  const productionCount = sprintFeatures.filter((f) => f.status === "production").length;
  const movingCount = sprintFeatures.filter((f) => f.status !== "production").length;
  const statusCounts: [string, number][] = [
    ["Plan", sprintFeatures.filter((f) => f.status === "plan").length],
    ["In Progress", sprintFeatures.filter((f) => f.status === "in_progress").length],
    ["Demo", sprintFeatures.filter((f) => f.status === "demo").length],
    ["Tested", sprintFeatures.filter((f) => f.status === "tested").length],
    ["Production", productionCount],
  ];

  const effectiveTarget = isNewSprint ? newNumber : targetSprint;
  const isDateRangeValid = !isNewSprint || (!!startDate && !!endDate && startDate <= endDate);
  const isValid = isDateRangeValid && effectiveTarget > currentSprint.number;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    if (isNewSprint) {
      onConfirm({ number: newNumber, name, startDate, endDate, focus });
    } else {
      // Move to existing sprint — carry forward default dates so sprint config is valid
      onConfirm({ number: effectiveTarget, name: "", startDate: toDateStr(defaultStart), endDate: toDateStr(defaultEnd), focus: "" });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
          <div className="flex items-center gap-2">
            <Lock size={18} className="text-accent" />
            <h2 className="text-lg font-semibold text-stone-800 font-display">Close Sprint</h2>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          {/* Sprint summary */}
          <div className="rounded-lg bg-stone-50 border border-stone-200 px-4 py-3 text-sm text-stone-600 space-y-2">
            <p className="font-medium text-stone-700">Sprint {currentSprint.number} Summary</p>
            {sprintFeatures.length > 0 ? (
              <>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {statusCounts.map(([label, count]) => count > 0 && (
                    <span key={label}>{label}: <span className="font-medium text-stone-700">{count}</span></span>
                  ))}
                </div>
                <div className="border-t border-stone-200 pt-2 space-y-1">
                  {productionCount > 0 && (
                    <p><span className="font-medium text-green-600">Production</span> features ({productionCount}) will be closed</p>
                  )}
                  {movingCount > 0 && (
                    <p>All other features ({movingCount}) move to Sprint {effectiveTarget}</p>
                  )}
                </div>
              </>
            ) : (
              <p>No features in the current sprint.</p>
            )}
          </div>

          {/* Target sprint selector */}
          {movingCount > 0 && (
            <div>
              <label className="text-xs text-stone-500 block mb-1">Move features to</label>
              <select
                value={targetSprint}
                onChange={(e) => setTargetSprint(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-md border border-stone-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent cursor-pointer"
              >
                {targetOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
                <option value={NEW_SPRINT}>+ New Sprint</option>
              </select>
            </div>
          )}

          {/* New sprint config — only when creating new */}
          {isNewSprint && (
            <>
              <div>
                <label className="text-xs text-stone-500 block mb-1">Sprint Number</label>
                <input
                  type="number"
                  value={newNumber}
                  onChange={(e) => setNewNumber(Number(e.target.value))}
                  min={currentSprint.number + 1}
                  className="w-full px-3 py-2 rounded-md border border-stone-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
                />
              </div>

              <div>
                <label className="text-xs text-stone-500 block mb-1">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Sprint name..."
                  className="w-full px-3 py-2 rounded-md border border-stone-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-stone-500 block mb-1">Start Date</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-md border border-stone-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
                  />
                </div>
                <div>
                  <label className="text-xs text-stone-500 block mb-1">End Date</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-md border border-stone-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
                  />
                </div>
              </div>
              {!isDateRangeValid && (startDate || endDate) && (
                <p className="text-xs text-red-500">
                  {!startDate || !endDate
                    ? "Both start and end dates are required."
                    : "End date must be after start date."}
                </p>
              )}

              <div>
                <label className="text-xs text-stone-500 block mb-1">Focus</label>
                <input
                  type="text"
                  value={focus}
                  onChange={(e) => setFocus(e.target.value)}
                  placeholder="Sprint focus..."
                  className="w-full px-3 py-2 rounded-md border border-stone-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
                />
              </div>
            </>
          )}

          {/* Failure warning */}
          {failedCount != null && failedCount > 0 && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {failedCount} feature{failedCount === 1 ? "" : "s"} failed to move. You can close this modal and retry, or check the GitHub issues manually.
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2">
            <button
              type="submit"
              disabled={isPending || !isValid}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-accent text-white text-sm font-medium rounded-lg hover:bg-accent/90 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {isPending ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Closing Sprint...
                </>
              ) : (
                <>
                  <Lock size={14} />
                  Close Sprint {currentSprint.number}
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="px-4 py-2.5 border border-stone-200 text-sm text-stone-600 rounded-lg hover:bg-stone-50 cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function toDateStr(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
