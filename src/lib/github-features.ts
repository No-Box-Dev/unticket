/* eslint-disable @typescript-eslint/no-explicit-any */
// Browser-side feature CRUD. All mutations go through Pages Functions
// (functions/api/features*) so the GitHub write + D1 mirror happen in one
// place on the server — see functions/lib/feature-issues.js. The browser
// never talks to Octokit for features anymore: the read path hits D1
// directly (fetchFeaturesFromD1) and writes hit /api/features.
import { apiGet, apiPost, apiPatch, apiDelete } from "./api";
import type { Feature, FeatureStatus, SpecLink, StatusHistoryEntry } from "./types";

// D1-backed row shape returned by /api/features
interface D1FeatureRow {
  number: number;
  title: string;
  state: string;
  body: string;
  assignees: { login: string }[];
  labels: { name: string; color: string }[];
  html_url: string | null;
  updated_at?: string;
}

const UNTICKET_LABEL = "unticket";
const FEATURE_LABEL = "feature";
const BACKLOG_LABEL = "backlog";
const STATUS_PREFIX = "status:";

// ---------- Metadata (hidden in issue body) ----------

const METADATA_RE = /\n?<!-- unticket:metadata\n([\s\S]*?)\n-->\s*$/;

interface FeatureMetadata {
  statusHistory?: StatusHistoryEntry[];
  specLinks?: SpecLink[];
}

function parseMetadata(body: string): { content: string; metadata: FeatureMetadata } {
  const match = body.match(METADATA_RE);
  if (!match) return { content: body, metadata: {} };
  try {
    const metadata = JSON.parse(match[1]) as FeatureMetadata;
    return { content: body.slice(0, match.index!), metadata };
  } catch (e) {
    console.warn("[unticket] Corrupt feature metadata block, ignoring:", e);
    return { content: body, metadata: {} };
  }
}

export function withStatusTransition(feature: Feature, newStatus: FeatureStatus): Feature {
  if (feature.status === newStatus) return feature;
  const history = [...(feature.statusHistory ?? [])];
  history.push({ status: newStatus, timestamp: new Date().toISOString() });
  return { ...feature, status: newStatus, statusHistory: history };
}

// ---------- Helpers ----------

function extractLabel(labels: string[], prefix: string): string | undefined {
  return labels.find((l) => l.startsWith(prefix))?.slice(prefix.length);
}

function issueToFeature(issue: any): Feature {
  const labelNames = (issue.labels ?? [])
    .map((l: any) => (typeof l === "string" ? l : l.name))
    .filter(Boolean) as string[];

  const labelStatus = extractLabel(labelNames, STATUS_PREFIX) as FeatureStatus | undefined;
  const status: FeatureStatus = labelStatus ?? "todo";
  const backlog = labelNames.includes(BACKLOG_LABEL);

  // Feature body still contains a legacy plan-text prefix on rows written
  // before the plan concept was removed — parseMetadata splits it off so
  // metadata stays readable, but we drop the content and rely on Specs
  // for all rich content going forward.
  const rawBody = issue.body ?? "";
  const { metadata } = parseMetadata(rawBody);

  return {
    id: issue.number,
    title: issue.title,
    owners: (issue.assignees ?? []).map((a: any) => a.login),
    status,
    backlog,
    url: issue.html_url,
    updatedAt: issue.updated_at,
    statusHistory: metadata.statusHistory,
    specLinks: metadata.specLinks,
  };
}

// ---------- D1-backed fetch (no GitHub API calls) ----------

function d1RowToFeature(row: D1FeatureRow): Feature {
  const feature = issueToFeature({
    number: row.number,
    title: row.title,
    body: row.body,
    labels: row.labels,
    assignees: row.assignees,
    html_url: row.html_url,
    updated_at: row.updated_at,
  });
  return feature;
}

export async function fetchFeaturesFromD1(): Promise<Feature[]> {
  const rows = await apiGet<D1FeatureRow[]>("/api/features?state=open");
  return rows
    .filter((row) => {
      const names = new Set(row.labels.map((l) => l.name));
      return names.has(UNTICKET_LABEL) && names.has(FEATURE_LABEL);
    })
    .map(d1RowToFeature);
}

// ---------- CRUD (server-proxied) ----------
//
// All writes go through the shared api helpers so failures broadcast `ut:error`
// (surfaced as a toast) instead of throwing silently. The server response shape
// from /api/features* is already the Feature shape (ghIssueToFeature on the
// server). We trust it and return as-is.

export async function createFeature(
  _org: string,
  title: string,
  opts: {
    status: FeatureStatus;
    owners?: string[];
  },
): Promise<Feature> {
  return apiPost<Feature>("/api/features", {
    title,
    status: opts.status,
    owners: opts.owners ?? [],
  });
}

export async function updateFeature(_org: string, updated: Feature): Promise<Feature> {
  return apiPatch<Feature>(`/api/features/${updated.id}`, {
    title: updated.title,
    status: updated.status,
    owners: updated.owners,
    backlog: updated.backlog ?? false,
    specLinks: updated.specLinks ?? [],
  });
}

export async function deleteFeature(_org: string, issueNumber: number): Promise<void> {
  await apiDelete<unknown>(`/api/features/${issueNumber}`);
}
