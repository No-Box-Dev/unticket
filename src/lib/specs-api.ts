import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import type { Spec, SpecFolder, SpecLink } from "@/lib/types";

// ---------- Folders ----------

export interface FolderListResponse {
  folders: SpecFolder[];
}

export function fetchSpecFolders(includeArchived = false): Promise<FolderListResponse> {
  const qs = includeArchived ? "?include=all" : "";
  return apiGet<FolderListResponse>(`/api/spec-folders${qs}`);
}

export function createSpecFolder(input: {
  name: string;
  description?: string;
  owner?: string | null;
}): Promise<SpecFolder> {
  return apiPost<SpecFolder>("/api/spec-folders", input);
}

export function updateSpecFolder(
  id: number,
  patch: { name?: string; description?: string | null; owner?: string | null },
): Promise<SpecFolder> {
  return apiPatch<SpecFolder>(`/api/spec-folders/${id}`, patch);
}

export interface ArchiveFolderResponse {
  ok: true;
  id: number;
  archived: boolean;
  cascadedSpecIds?: number[];
}

export function archiveSpecFolder(id: number): Promise<ArchiveFolderResponse> {
  return apiPost<ArchiveFolderResponse>(`/api/spec-folders/${id}/archive`);
}

export function unarchiveSpecFolder(id: number): Promise<ArchiveFolderResponse> {
  return apiDelete<ArchiveFolderResponse>(`/api/spec-folders/${id}/archive`);
}

// ---------- Specs ----------

export type SpecFeatureFilter = number | "unfiled" | "all";

export interface SpecListResponse {
  specs: Spec[];
}

export function fetchSpecs(opts: {
  featureNumber?: SpecFeatureFilter;
  includeArchived?: boolean;
} = {}): Promise<SpecListResponse> {
  const params = new URLSearchParams();
  if (opts.featureNumber !== undefined && opts.featureNumber !== "all") {
    params.set("featureNumber", String(opts.featureNumber));
  }
  if (opts.includeArchived) params.set("include", "all");
  const qs = params.toString();
  return apiGet<SpecListResponse>(`/api/specs${qs ? `?${qs}` : ""}`);
}

export function fetchSpec(id: number): Promise<Spec> {
  return apiGet<Spec>(`/api/specs/${id}`);
}

export function createSpec(input: {
  title: string;
  description?: string;
  featureNumber?: number | null;
  links?: SpecLink[];
}): Promise<Spec> {
  return apiPost<Spec>("/api/specs", input);
}

export function updateSpec(
  id: number,
  patch: {
    title?: string;
    description?: string;
    featureNumber?: number | null;
    links?: SpecLink[];
  },
): Promise<Spec> {
  return apiPatch<Spec>(`/api/specs/${id}`, patch);
}

export interface ArchiveSpecResponse {
  ok: true;
  id: number;
  archived: boolean;
}

export function archiveSpec(id: number): Promise<ArchiveSpecResponse> {
  return apiPost<ArchiveSpecResponse>(`/api/specs/${id}/archive`);
}

export function unarchiveSpec(id: number): Promise<ArchiveSpecResponse> {
  return apiDelete<ArchiveSpecResponse>(`/api/specs/${id}/archive`);
}
