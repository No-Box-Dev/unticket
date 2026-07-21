export interface OrgInfo {
  login: string;
  avatar_url: string;
  description: string | null;
}

export interface RepoInfo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  open_issues_count: number;
  pushed_at: string | null;
  language: string | null;
  visibility: string;
  // First time this (org_id, name) was seen by sync. Set on first insert,
  // preserved via COALESCE on every subsequent reconcile.
  discoveredAt?: string | null;
  // Set by POST /api/repos/acknowledge when an admin reviews the repo.
  // NULL means the repo is "new" and should appear in the NewRepoBanner
  // + Settings → Newly detected section.
  acknowledgedAt?: string | null;
  // True for drafts (platform-archived), GH-archived, or the unticket repo.
  // Only present when the endpoint is called with `?include=all`.
  inactive?: boolean;
}

export interface PRInfo {
  id: number;
  number: number;
  title: string;
  state: string;
  created_at: string;
  updated_at: string;
  user: { login: string; avatar_url: string } | null;
  labels: { name: string; color: string }[];
  draft: boolean;
  requested_reviewers: { login: string }[];
  head: { ref: string; repo: { name: string; full_name: string } | null };
  base: { ref: string };
  html_url: string;
}

export interface IssueInfo {
  id: number;
  number: number;
  title: string;
  state: string;
  created_at: string;
  updated_at: string;
  user: { login: string; avatar_url: string } | null;
  labels: { name: string; color: string }[];
  assignees: { login: string; avatar_url: string }[];
  milestone: { title: string } | null;
  html_url: string;
}

export type TabId =
  | "sprint"
  | "specs"
  | "prs"
  | "issues"
  | "posts"
  | "repos"
  | "engineers"
  | "settings";

export interface NavFilter {
  person?: string;
  view?: string;
}

/** PR where the user is a requested reviewer */
export interface ReviewPR {
  repo: string;
  number: number;
  title: string;
  state: string;
  draft: boolean;
  merged_at: string | null;
  html_url: string;
  author: string | null;
  created_at: string;
}

/** Cross-repo issue assigned to the user (sourced from D1, not unticket repo) */
export interface AssignedIssue {
  repo: string;
  number: number;
  title: string;
  state: "open" | "closed";
  html_url: string;
  labels: { name: string; color: string }[];
  created_at: string;
}

// unticket config repo types

// Status IDs are now admin-configurable per org (see BoardStage + useBoardStages).
// The default ids match the historical scheme so existing features keep working
// before an admin customises anything.
export type FeatureStatus = string;

/** An admin-configurable board column. `id` is the GitHub label suffix (`status:<id>`). */
export interface BoardStage {
  id: string;
  label: string;
  color: string; // hex, e.g. "#94a3b8"
}

export interface StatusHistoryEntry {
  status: FeatureStatus;
  timestamp: string; // ISO 8601
}

/** A link from a feature out to a spec / doc / design (any external URL). */
export interface SpecLink {
  url: string;       // http(s) only — sanitized server-side before storage
  label?: string;    // optional friendly name; falls back to the URL when absent
  /** At most one link per Spec's `links` array may be primary. When set,
   * external chip-clicks (e.g. on FeatureCard) open this link; when unset
   * the first link is the effective primary. */
  primary?: boolean;
}

export interface Feature {
  id: number;
  title: string;
  owners: string[];
  status: FeatureStatus;
  url?: string;
  updatedAt?: string;
  statusHistory?: StatusHistoryEntry[];
  specLinks?: SpecLink[];
  /** IDs of manual Specs (from the Specs tab) linked to this feature. */
  linkedSpecIds?: number[];
  /** Backlogged features are parked out of the kanban board — they keep
   * their status label so returning to the board lands them in the
   * column they left. Derived from the `backlog` GitHub label. */
  backlog?: boolean;
  // True while an optimistic create is in flight — the card carries a
  // temporary negative id and renders non-interactive until GitHub assigns
  // the real issue number. Never set on features returned by the server.
  pending?: boolean;
}

export interface Person {
  github: string;
  name: string;
  role: string;
  team?: string;
  description?: string;
}

// Manual Specs feature (see /api/specs, /api/spec-folders).
// Specs live entirely in D1 — no GitHub round-trip, no repo folder proxy.

/** A user-created "Project" that groups specs. Org-scoped. */
export interface SpecFolder {
  id: number;
  name: string;
  description: string | null;
  /** GitHub login of the project owner, or null when unset. */
  owner: string | null;
  archived: boolean;
  archivedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  specCount: number;
}

/** A single spec: Markdown description + external links, belonging to a
 * Feature (via issue number) or Unfiled. */
export interface Spec {
  id: number;
  /** @deprecated The Projects/folders concept was unified into Features
   * (migration 0037). Server still returns this for backwards-compat but
   * new code should use `featureNumber`. */
  folderId: number | null;
  /** Issue number of the Feature this spec belongs to, or null when unfiled. */
  featureNumber: number | null;
  /** Breadcrumb from the pre-unification Projects world so specs that were
   * in a folder can display "was in X" instead of losing the association. */
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

export interface OrgSettings {
  excludedMembers?: string[];
  unticketRepo?: string;
  boardStages?: BoardStage[];
  // Admin-editable system prompt for the Release-notes feed. Empty/missing
  // falls back to the bundled default (RELEASE_NOTES_SYSTEM in
  // functions/lib/prompt.js). The LLM provider/model is NOT configurable
  // per-feed — both Posts and Release notes share the org's LLM config.
  releaseNotesPrompt?: string;
  // Per-feed Slack channel selections. The bot install (token + team
  // metadata) lives in the separate slack_settings table — the only thing
  // in settings.slack is which channels each feed should post to.
  slack?: {
    postsChannelId?: string;
    releaseNotesChannelId?: string;
  };
  // Policy for newly-discovered repos.
  //  - 'include' (default): the repo is active immediately (current behavior).
  //  - 'exclude':           the repo is platform-archived (draft) on first
  //                         insert so it stays out of every active scope
  //                         until an admin clicks Track in the Newly
  //                         detected section. The discovery banner +
  //                         TopNav dot still surface either way.
  newRepoDefault?: "include" | "exclude";
}

// Extended issue info with repo context
export interface IssueWithRepo extends IssueInfo {
  repo: string;
}

// Metric types
export interface WeeklyBucket {
  weekStart: string;
  value: number;
}

export interface MetricData {
  current: number;
  previous: number;
  change: number;
  history: WeeklyBucket[];
}
