// Resolves the configured kanban columns for the current org. Admins can
// rename/recolor/add/remove stages via Settings → Board stages; when no
// override exists, this returns the historical 4-column layout so existing
// features and labels keep rendering.
import { useMemo } from "react";
import { useSettings } from "@/hooks/useConfigRepo";
import type { BoardStage, OrgSettings } from "@/lib/types";

export const DEFAULT_BOARD_STAGES: BoardStage[] = [
  { id: "todo",       label: "To do",                color: "#94a3b8" },
  { id: "staging",    label: "Testing on staging",   color: "#b89464" },
  { id: "ready",      label: "Ready for production", color: "#6a9991" },
  { id: "production", label: "On production",        color: "#6e9970" },
];

export const MIN_BOARD_STAGES = 1;
export const MAX_BOARD_STAGES = 10;

export function resolveBoardStages(settings: OrgSettings | null | undefined): BoardStage[] {
  const stages = settings?.boardStages;
  if (!Array.isArray(stages) || stages.length === 0) return DEFAULT_BOARD_STAGES;
  return stages;
}

export function useBoardStages(): BoardStage[] {
  const { data: settings } = useSettings();
  return useMemo(() => resolveBoardStages(settings ?? null), [settings]);
}

const STAGE_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function isValidStageId(id: string): boolean {
  return STAGE_ID_RE.test(id);
}

export function isValidStageColor(color: string): boolean {
  return HEX_COLOR_RE.test(color);
}

// Build a stable id from a free-text label; fall back to "stage" when the
// label contains no usable characters. Caller still needs to de-dupe.
export function slugifyStageId(label: string): string {
  const slug = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return slug || "stage";
}
