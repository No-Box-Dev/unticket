import { useState, useMemo } from "react";
import { X, FastForward, Loader2 } from "lucide-react";
import type { SprintConfig, Feature } from "@/lib/types";

interface NewSprintModalProps {
  currentSprint: SprintConfig;
  features: Feature[];
  onConfirm: (newSprint: SprintConfig) => void;
  onClose: () => void;
  isPending: boolean;
  failedCount?: number;
}

export function NewSprintModal({ currentSprint, features, onConfirm, onClose, isPending, failedCount }: NewSprintModalProps) {
  const nextNumber = currentSprint.number + 1;

  // Compute default dates: start = day after current end, same duration
  const currentStart = new Date(currentSprint.startDate);
  const currentEnd = new Date(currentSprint.endDate);
  const durationMs = currentEnd.getTime() - currentStart.getTime();
  const defaultStart = new Date(currentEnd.getTime() + 86400000); // +1 day
  const defaultEnd = new Date(defaultStart.getTime() + durationMs);

  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState(toDateStr(defaultStart));
  const [endDate, setEndDate] = useState(toDateStr(defaultEnd));
  const [focus, setFocus] = useState("");

  const sprintFeatures = useMemo(
    () => features.filter((f) => f.sprint === currentSprint.number && f.status !== "future"),
    [features, currentSprint.number],
  );

  const productionCount = sprintFeatures.filter((f) => f.status === "production").length;
  const movingCount = sprintFeatures.filter((f) => f.status === "plan" || f.status === "demo").length;

  const isDateRangeValid = !!startDate && !!endDate && startDate <= endDate;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isDateRangeValid) return;
    onConfirm({
      number: nextNumber,
      name,
      startDate,
      endDate,
      focus,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
          <div className="flex items-center gap-2">
            <FastForward size={18} className="text-brand" />
            <h2 className="text-lg font-semibold text-stone-800 font-display">New Sprint</h2>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          {/* Explanation */}
          <div className="rounded-lg bg-stone-50 border border-stone-200 px-4 py-3 text-sm text-stone-600 space-y-1">
            {productionCount > 0 && (
              <p>
                <span className="font-medium text-green-600">Production</span> features ({productionCount}) will be archived on Sprint {currentSprint.number}
              </p>
            )}
            {movingCount > 0 && (
              <p>
                <span className="font-medium text-brand">Plan</span> and <span className="font-medium text-amber-600">Demo</span> features ({movingCount}) will move to Sprint {nextNumber}
              </p>
            )}
            {productionCount === 0 && movingCount === 0 && (
              <p>No features in the current sprint.</p>
            )}
          </div>

          {/* Sprint number (read-only) */}
          <div>
            <label className="text-xs text-stone-500 block mb-1">Sprint Number</label>
            <div className="px-3 py-2 rounded-md border border-stone-200 bg-stone-50 text-sm text-stone-700">
              {nextNumber}
            </div>
          </div>

          {/* Name */}
          <div>
            <label className="text-xs text-stone-500 block mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sprint name..."
              className="w-full px-3 py-2 rounded-md border border-stone-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
            />
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-stone-500 block mb-1">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 rounded-md border border-stone-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
              />
            </div>
            <div>
              <label className="text-xs text-stone-500 block mb-1">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 rounded-md border border-stone-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
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

          {/* Focus */}
          <div>
            <label className="text-xs text-stone-500 block mb-1">Focus</label>
            <input
              type="text"
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              placeholder="Sprint focus..."
              className="w-full px-3 py-2 rounded-md border border-stone-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
            />
          </div>

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
              disabled={isPending || !isDateRangeValid}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-brand text-white text-sm font-medium rounded-lg hover:bg-brand/90 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {isPending ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Starting Sprint...
                </>
              ) : (
                <>
                  <FastForward size={14} />
                  Start Sprint
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
