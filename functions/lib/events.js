// Webhook → events INSERT path. One row per github action (pr:opened,
// pr:merged, push, issues:opened, ...). Read by the in-app Posts tab and
// (later) the narrator cron, which writes back rows of type='narrative'.
//
// Ported from workers/noxlink-brain/src/webhook.ts (storeEvent + helpers).

import { resolveActorFromGithub } from "./actors";
import { upsertGhUser } from "./gh-mirror";

export function mapEventType(ghEvent, action, payload) {
  switch (ghEvent) {
    case "pull_request":
      if (action === "opened") return "github:pr:opened";
      if (action === "closed") return payload.pull_request?.merged ? "github:pr:merged" : "github:pr:closed";
      if (action === "reopened") return "github:pr:reopened";
      return null;
    case "push":
      return "github:push";
    case "release":
      if (action === "published") return "github:release:published";
      return null;
    case "issues":
      if (action === "opened") return "github:issue:opened";
      if (action === "closed") return "github:issue:closed";
      return null;
    case "pull_request_review":
      if (action === "submitted") {
        const state = payload.review?.state;
        if (state === "approved") return "github:pr:review:approved";
        if (state === "changes_requested") return "github:pr:review:changes_requested";
        if (state === "commented") return "github:pr:review:commented";
      }
      return null;
    case "repository":
      if (action === "archived") return "github:repo:archived";
      if (action === "unarchived") return "github:repo:unarchived";
      if (action === "deleted") return "github:repo:deleted";
      if (action === "transferred") return "github:repo:transferred";
      if (action === "renamed") return "github:repo:renamed";
      return null;
    case "installation":
      return `github:installation:${action ?? "unknown"}`;
    case "installation_repositories":
      return `github:installation_repos:${action ?? "unknown"}`;
    default:
      return null;
  }
}

function pickAuthor(ghEvent, payload) {
  const candidate =
    ghEvent === "pull_request" ? payload.pull_request?.user :
    ghEvent === "issues" ? payload.issue?.user :
    ghEvent === "release" ? payload.release?.author :
    ghEvent === "pull_request_review" ? payload.review?.user :
    payload.sender;
  if (!candidate?.login) return null;
  return {
    login: candidate.login,
    id: candidate.id ?? null,
    avatar_url: candidate.avatar_url ?? null,
    type: candidate.type === "Bot" ? "Bot" : candidate.type === "User" ? "User" : null,
    name: candidate.name ?? null,
  };
}

function buildSummary(type, payload) {
  if (type.startsWith("github:pr:")) {
    const pr = payload.pull_request;
    if (pr) return `PR #${pr.number}: ${pr.title}`;
  }
  if (type === "github:push") {
    const ref = payload.ref?.replace("refs/heads/", "") || "?";
    const count = payload.commits?.length ?? 0;
    return `Push to ${ref} (${count} commit${count === 1 ? "" : "s"})`;
  }
  if (type === "github:release:published") {
    return `Release ${payload.release?.tag_name ?? "?"}`;
  }
  if (type.startsWith("github:issue:")) {
    const issue = payload.issue;
    if (issue) return `Issue #${issue.number}: ${issue.title}`;
  }
  if (type.startsWith("github:pr:review:")) {
    const pr = payload.pull_request;
    const state = payload.review?.state ?? "reviewed";
    if (pr) return `Review (${state}) on PR #${pr.number}: ${pr.title}`;
  }
  if (type.startsWith("github:repo:")) {
    const action = type.split(":")[2];
    const repo = payload.repository?.full_name ?? payload.repository?.name ?? "?";
    return `Repository ${action}: ${repo}`;
  }
  if (type.startsWith("github:installation")) {
    return `Installation ${payload.action ?? ""}`.trim();
  }
  return type;
}

// Strip large fields before persisting so a single big push doesn't blow
// the row size. Mirror of NoxLink's slimPayload.
function slimPayload(ghEvent, payload) {
  if (ghEvent === "push") {
    return {
      ref: payload.ref,
      before: payload.before,
      after: payload.after,
      pusher: payload.pusher?.name,
      commits: (payload.commits ?? []).slice(0, 10).map((c) => ({
        id: c.id,
        message: c.message?.slice(0, 200),
        author: c.author?.name,
        added: c.added,
        modified: c.modified,
        removed: c.removed,
      })),
    };
  }
  if (ghEvent === "pull_request" && payload.pull_request) {
    const pr = payload.pull_request;
    return {
      action: payload.action,
      pr: {
        number: pr.number,
        title: pr.title,
        body: pr.body?.slice(0, 1000),
        state: pr.state,
        merged: pr.merged,
        author: pr.user?.login,
        additions: pr.additions,
        deletions: pr.deletions,
        changed_files: pr.changed_files,
      },
    };
  }
  if (ghEvent === "pull_request_review" && payload.review) {
    const pr = payload.pull_request;
    return {
      action: payload.action,
      review: {
        state: payload.review.state,
        body: payload.review.body?.slice(0, 1000),
        author: payload.review.user?.login,
        submitted_at: payload.review.submitted_at,
      },
      pr: pr ? { number: pr.number, title: pr.title, author: pr.user?.login } : null,
    };
  }
  if (ghEvent === "repository") {
    return {
      action: payload.action,
      repo: payload.repository?.full_name ?? payload.repository?.name ?? null,
      changes: payload.changes ?? null,
    };
  }
  return { action: payload.action };
}

// INSERT into events. Returns { id } on insert, null if the event type
// isn't tracked or the delivery_id collides.
export async function storeEvent(db, ghEvent, deliveryId, payload, ownerId) {
  const action = payload.action;
  const type = mapEventType(ghEvent, action, payload);
  if (!type) return null;

  const repo = payload.repository?.name ?? null;
  const org = payload.organization?.login ?? payload.repository?.owner?.login ?? null;
  const summary = buildSummary(type, payload);

  // Auto-register the repo as a project on first sight so the dashboard
  // surfaces it immediately. Mirrors NoxLink's storeEvent.
  let projectId = null;
  if (repo && org) {
    projectId = `proj_${org}_${repo}`.toLowerCase();
    await db.prepare(
      `INSERT OR IGNORE INTO projects (id, name, org, repo, owner_id, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ).bind(projectId, repo, org, repo, ownerId).run();
  }

  // Resolve the actor from whoever triggered the event. Prefer the typed
  // author for PRs/issues/releases; fall back to sender for everything else.
  const author = pickAuthor(ghEvent, payload);
  if (author?.id != null) {
    try {
      await upsertGhUser(db, {
        id: author.id,
        login: author.login,
        avatar_url: author.avatar_url,
        type: author.type ?? "User",
        name: author.name,
      });
    } catch (err) {
      console.error("[unticket events] upsertGhUser failed:", err);
    }
  }
  const actor = author ? await resolveActorFromGithub(db, ownerId, author) : null;

  const result = await db.prepare(
    `INSERT INTO events (delivery_id, source, type, actor_id, project_id, org, repo, summary, payload_json, owner_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(delivery_id) DO NOTHING`
  ).bind(
    deliveryId || null,
    "github-app",
    type,
    actor?.id ?? null,
    projectId,
    org,
    repo,
    summary,
    JSON.stringify(slimPayload(ghEvent, payload)),
    ownerId,
  ).run();

  const id = result?.meta?.last_row_id;
  return id ? { id } : null;
}
