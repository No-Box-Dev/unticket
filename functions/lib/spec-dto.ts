// Shared DTO shape + row-to-DTO mapper for the manual Specs feature.
// Both /api/specs and /api/specs/:id return the same shape, so the mapper
// lives here (Pages Functions can't safely cross-import between route files).

import { sanitizeSpecLinks, type SpecLink } from "./spec-links";

export interface SpecRow {
  id: number;
  org_id: number;
  folder_id: number | null;
  feature_number: number | null;
  legacy_folder_name: string | null;
  title: string;
  description: string;
  links_json: string;
  archived: number;
  archived_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface SpecDto {
  id: number;
  /**
   * @deprecated Unified into featureNumber (migration 0037). Kept in the DTO
   * so existing clients that still send folderId don't crash mid-rollout.
   */
  folderId: number | null;
  /** Issue number of the Feature this spec belongs to, or null when unfiled. */
  featureNumber: number | null;
  /** Breadcrumb: name of the pre-unification project this spec came from. */
  legacyFolderName: string | null;
  title: string;
  description: string;
  links: SpecLink[];
  archived: boolean;
  archivedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export function specRowToDto(row: SpecRow): SpecDto {
  let links: SpecLink[] = [];
  try {
    const parsed = JSON.parse(row.links_json || "[]");
    links = sanitizeSpecLinks(parsed);
  } catch {
    links = [];
  }
  return {
    id: row.id,
    folderId: row.folder_id,
    featureNumber: row.feature_number,
    legacyFolderName: row.legacy_folder_name,
    title: row.title,
    description: row.description ?? "",
    links,
    archived: row.archived === 1,
    archivedAt: row.archived_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
