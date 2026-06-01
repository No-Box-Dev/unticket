// Drizzle schema for the unticket D1 database.
//
// IMPORTANT: This describes the EXISTING schema for typed queries only — it is
// NOT the migration source. Schema changes still go through numbered files in
// `/migrations/*.sql` applied via `wrangler d1 migrations apply`. Keep this file
// in sync with those migrations by hand.
//
// Tables are added here as endpoints migrate to `getDb()` (functions/lib/db-client.ts).
// Only tables that are queried through Drizzle need to live here.

import { sqliteTable, integer, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const pullRequests = sqliteTable(
  "pull_requests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    orgId: integer("org_id").notNull(),
    repo: text("repo").notNull(),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    state: text("state").notNull(),
    author: text("author"),
    authorAvatar: text("author_avatar"),
    draft: integer("draft").default(0),
    headRef: text("head_ref"),
    baseRef: text("base_ref"),
    mergedAt: text("merged_at"),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
    htmlUrl: text("html_url"),
    requestedReviewersJson: text("requested_reviewers_json").default("[]"),
    labelsJson: text("labels_json").default("[]"),
  },
  (t) => [
    uniqueIndex("uniq_prs_org_repo_number").on(t.orgId, t.repo, t.number),
    index("idx_prs_state_updated").on(t.orgId, t.state, t.updatedAt),
    index("idx_prs_author").on(t.orgId, t.author),
    index("idx_prs_repo").on(t.orgId, t.repo),
  ],
);

export const issues = sqliteTable(
  "issues",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    orgId: integer("org_id").notNull(),
    repo: text("repo").notNull(),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    state: text("state").notNull(),
    author: text("author"),
    authorAvatar: text("author_avatar"),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
    closedAt: text("closed_at"),
    htmlUrl: text("html_url"),
    assigneesJson: text("assignees_json").default("[]"),
    labelsJson: text("labels_json").default("[]"),
    milestoneTitle: text("milestone_title"),
    closedBy: text("closed_by"),
  },
  (t) => [
    uniqueIndex("uniq_issues_org_repo_number").on(t.orgId, t.repo, t.number),
    index("idx_issues_state_updated").on(t.orgId, t.state, t.updatedAt),
    index("idx_issues_closed_at").on(t.orgId, t.closedAt),
    index("idx_issues_repo").on(t.orgId, t.repo),
    // Added in migrations/0026_engineer_indexes.sql
    index("idx_issues_closed_by").on(t.orgId, t.closedBy),
  ],
);

export const members = sqliteTable(
  "members",
  {
    orgId: integer("org_id").notNull(),
    login: text("login").notNull(),
    avatarUrl: text("avatar_url"),
    kind: text("kind"),
    ghUserId: integer("gh_user_id"),
  },
  (t) => [uniqueIndex("uniq_members_org_login").on(t.orgId, t.login)],
);

export const events = sqliteTable(
  "events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    deliveryId: text("delivery_id").unique(),
    source: text("source").notNull(),
    type: text("type").notNull(),
    actorId: text("actor_id"),
    projectId: text("project_id"),
    org: text("org"),
    repo: text("repo"),
    summary: text("summary"),
    payloadJson: text("payload_json"),
    ownerId: text("owner_id"),
    createdAt: text("created_at"),
  },
  (t) => [
    index("idx_events_created").on(t.createdAt),
    index("idx_events_type").on(t.type),
  ],
);
