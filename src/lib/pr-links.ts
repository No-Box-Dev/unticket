import { apiGet, apiPost, apiDelete } from "./api";

export interface PRLinkRow {
  pr_repo: string;
  pr_number: number;
  source: string;
  created_at: string;
  pr_title?: string | null;
  pr_author?: string | null;
  pr_author_avatar?: string | null;
  pr_state?: string | null;
  pr_merged_at?: string | null;
  pr_html_url?: string | null;
}

export interface FeatureLinkRow {
  feature_number: number;
  feature_title: string | null;
  source: string;
  created_at: string;
}

export function fetchLinkedPRs(featureNumber: number): Promise<PRLinkRow[]> {
  return apiGet<PRLinkRow[]>(`/api/pr-links?feature=${featureNumber}`);
}

export function fetchLinkedFeatures(repo: string, number: number): Promise<FeatureLinkRow[]> {
  return apiGet<FeatureLinkRow[]>(
    `/api/pr-links?pr_repo=${encodeURIComponent(repo)}&pr_number=${number}`,
  );
}

export async function linkPR(
  featureNumber: number,
  prRepo: string,
  prNumber: number,
): Promise<{ ok: boolean }> {
  return apiPost("/api/pr-links", {
    feature_number: featureNumber,
    pr_repo: prRepo,
    pr_number: prNumber,
  });
}

export async function unlinkPR(
  featureNumber: number,
  prRepo: string,
  prNumber: number,
): Promise<{ ok: boolean }> {
  return apiDelete<{ ok: boolean }>(
    `/api/pr-links?feature=${featureNumber}&pr_repo=${encodeURIComponent(prRepo)}&pr_number=${prNumber}`,
  );
}

export interface BackfillMatchesResult {
  ok: boolean;
  scanned: number;
  queued: number;
  repos?: number;
  reposInTable?: number;
  prsSeen?: number;
  prsLinked?: number;
  errors?: string[];
  capped?: boolean;
  days: number;
  force: boolean;
}

export function backfillFeatureMatches(
  days: number,
  force: boolean,
): Promise<BackfillMatchesResult> {
  return apiPost("/api/features/backfill-matches", { days, force });
}

export interface UnlinkAllResult {
  ok: boolean;
  featuresAffected: number;
  featuresCleared: number;
  linksDeleted: number;
  attemptsCleared: number;
  errors: string[];
}

export function unlinkAllPRs(): Promise<UnlinkAllResult> {
  return apiPost("/api/pr-links/unlink-all", { confirm: "UNLINK_ALL" });
}
