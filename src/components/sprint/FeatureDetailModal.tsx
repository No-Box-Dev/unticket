import { X } from "lucide-react";
import { EffortTag } from "./EffortTag";
import { AssignDropdown } from "./AssignDropdown";
import type { Feature, Effort } from "@/lib/types";

interface FeatureDetailModalProps {
  feature: Feature;
  allPeople: string[];
  onClose: () => void;
  onUpdate: (updated: Feature) => void;
}

export function FeatureDetailModal({ feature, allPeople, onClose, onUpdate }: FeatureDetailModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
          <h2 className="text-lg font-semibold text-stone-800">{feature.title}</h2>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div className="flex items-center gap-4">
            <div>
              <span className="text-xs text-stone-500 block mb-1">Team</span>
              <span className="text-sm text-stone-700">{feature.team}</span>
            </div>
            <div>
              <span className="text-xs text-stone-500 block mb-1">Sprint</span>
              <span className="text-sm text-stone-700">{feature.sprint ?? "Backlog"}</span>
            </div>
            <div>
              <span className="text-xs text-stone-500 block mb-1">Effort</span>
              <EffortTag
                effort={feature.effort}
                onChange={(effort: Effort) => onUpdate({ ...feature, effort })}
              />
            </div>
            <div>
              <span className="text-xs text-stone-500 block mb-1">Owners</span>
              <AssignDropdown
                owners={feature.owners}
                allPeople={allPeople}
                onChange={(owners) => onUpdate({ ...feature, owners })}
              />
            </div>
          </div>

          {feature.description && (
            <div>
              <span className="text-xs text-stone-500 block mb-1">Description</span>
              <p className="text-sm text-stone-700 whitespace-pre-wrap">{feature.description}</p>
            </div>
          )}

          {feature.specs && feature.specs.length > 0 && (
            <div>
              <span className="text-xs text-stone-500 block mb-1">Specs</span>
              <ul className="text-sm text-stone-700 list-disc list-inside space-y-0.5">
                {feature.specs.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center gap-2 text-[10px] text-stone-400">
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ${
                feature.status === "done"
                  ? "bg-green-500"
                  : feature.status === "active"
                    ? "bg-blue-500"
                    : "bg-stone-300"
              }`}
            />
            {feature.status === "done" ? "Completed" : feature.status === "active" ? "Active" : "Future"}
          </div>
        </div>
      </div>
    </div>
  );
}
