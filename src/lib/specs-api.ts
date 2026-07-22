import { apiGet, apiPost, apiPatch, apiDelete, apiFetch } from "@/lib/api";
import type { Spec, SpecAttachment, SpecLink } from "@/lib/types";

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
    isPrimary?: boolean;
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

// ---------- Attachments ----------

export interface AttachmentListResponse {
  attachments: SpecAttachment[];
}

export function fetchAttachments(specId: number): Promise<AttachmentListResponse> {
  return apiGet<AttachmentListResponse>(`/api/specs/${specId}/attachments`);
}

/** Uploads via multipart — apiPost only speaks JSON, so this uses apiFetch
 * directly and handles the non-JSON error branch inline. */
export async function uploadAttachment(specId: number, file: File): Promise<SpecAttachment> {
  const form = new FormData();
  form.append("file", file);
  // apiFetch detects FormData and skips its default Content-Type so the
  // browser can set `multipart/form-data; boundary=...` itself.
  const res = await apiFetch(`/api/specs/${specId}/attachments`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const message = (body as { error?: string }).error ?? `Upload failed: ${res.status}`;
    throw new Error(message);
  }
  return (await res.json()) as SpecAttachment;
}

export function deleteAttachment(specId: number, attachmentId: number): Promise<{ ok: true; id: number }> {
  return apiDelete<{ ok: true; id: number }>(
    `/api/specs/${specId}/attachments/${attachmentId}`,
  );
}

/** Fetches an attachment as a Blob. Auth flows through `apiFetch` so the
 * Bearer token stays in the request header — the resulting blob URL is
 * safe to embed in an <iframe> or an <a download>. */
export async function fetchAttachmentBlob(
  specId: number,
  attachmentId: number,
  opts: { download?: boolean } = {},
): Promise<Blob> {
  const qs = opts.download ? "?disposition=attachment" : "";
  const res = await apiFetch(`/api/specs/${specId}/attachments/${attachmentId}${qs}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const message = (body as { error?: string }).error ?? `Fetch failed: ${res.status}`;
    throw new Error(message);
  }
  return res.blob();
}
