/* eslint-disable @typescript-eslint/no-explicit-any */
// Browser-side feature CRUD. All mutations go through Pages Functions
// (functions/api/features*) so the GitHub write + D1 mirror happen in one
// place on the server — see functions/lib/feature-issues.js. The browser
// never talks to Octokit for features anymore: the read path hits D1
// directly (fetchFeaturesFromD1) and writes hit /api/features.
import { apiGet, apiFetch } from "./api";
import type { Feature, FeatureStatus, StatusHistoryEntry, LinkedPR } from "./types";

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
  // Hydrated server-side from pr_feature_links — authoritative because the
  // LLM matcher writes to the table but not to the issue body metadata.
  linkedPRs?: LinkedPR[];
}

const UNTICKET_LABEL = "unticket";
const FEATURE_LABEL = "feature";
const STATUS_PREFIX = "status:";

// ---------- Metadata (hidden in issue body) ----------

const METADATA_RE = /\n?<!-- unticket:metadata\n([\s\S]*?)\n-->\s*$/;

interface FeatureMetadata {
  statusHistory?: StatusHistoryEntry[];
  linkedPRs?: LinkedPR[];
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

  const rawBody = issue.body ?? "";
  const { content, metadata } = parseMetadata(rawBody);

  return {
    id: issue.number,
    title: issue.title,
    owners: (issue.assignees ?? []).map((a: any) => a.login),
    status,
    plan: content || undefined,
    url: issue.html_url,
    updatedAt: issue.updated_at,
    statusHistory: metadata.statusHistory,
    linkedPRs: metadata.linkedPRs,
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
  // Server-hydrated linkedPRs from pr_feature_links wins over body metadata
  // so LLM matches (which only land in the table) show up on cards.
  if (row.linkedPRs) feature.linkedPRs = row.linkedPRs;
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
// The server response shape from /api/features* is already the Feature shape
// (ghIssueToFeature on the server). We trust it and return as-is.

async function handleFeatureResponse(res: Response): Promise<Feature> {
  if (res.ok) return (await res.json()) as Feature;
  const body = await res.json().catch(() => ({ error: res.statusText }));
  const message = (body as { error?: string }).error ?? `API error: ${res.status}`;
  throw new Error(message);
}

export async function createFeature(
  _org: string,
  title: string,
  opts: {
    status: FeatureStatus;
    owners?: string[];
    plan?: string;
  },
): Promise<Feature> {
  const res = await apiFetch("/api/features", {
    method: "POST",
    body: JSON.stringify({
      title,
      status: opts.status,
      owners: opts.owners ?? [],
      plan: opts.plan ?? "",
    }),
  });
  return handleFeatureResponse(res);
}

export async function updateFeature(_org: string, updated: Feature): Promise<Feature> {
  const res = await apiFetch(`/api/features/${updated.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      title: updated.title,
      status: updated.status,
      owners: updated.owners,
      plan: updated.plan ?? "",
    }),
  });
  return handleFeatureResponse(res);
}

export async function deleteFeature(_org: string, issueNumber: number): Promise<void> {
  const res = await apiFetch(`/api/features/${issueNumber}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error ?? `API error: ${res.status}`);
  }
}
