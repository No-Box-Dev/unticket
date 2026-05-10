import { jsonResponse, errorResponse } from "../lib/db";
import { upsertIssue, upsertFeature, upsertPR, upsertMember, removeMember } from "../lib/github-sync";
import { parseFeatureMetadata, parseFeatureFromBranch, parseFeaturesFromBody } from "../lib/feature-metadata";
import { storeEvent } from "../lib/events";
import { upsertInstallation, setInstallationRepos, getInstallationRepos } from "../lib/gh-mirror";
import { narrateEvent } from "../lib/narrator";

// Verify GitHub webhook signature (HMAC-SHA256)
async function verifySignature(secret, body, signature) {
  if (!signature) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const expected = `sha256=${hex}`;

  // Constant-time comparison — compare byte buffers, not JS string lengths
  // (avoids UTF-16 surrogate-pair quirks if a malformed signature header is sent)
  const a = encoder.encode(expected);
  const b = encoder.encode(signature);
  if (a.byteLength !== b.byteLength) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

// POST /api/webhook — GitHub webhook receiver
export async function onRequestPost(context) {
  const secret = context.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return errorResponse("Webhook secret not configured", 500);
  }

  const body = await context.request.text();
  const signature = context.request.headers.get("X-Hub-Signature-256");

  const valid = await verifySignature(secret, body, signature);
  if (!valid) {
    return errorResponse("Invalid signature", 401);
  }

  const event = context.request.headers.get("X-GitHub-Event");
  const deliveryId = context.request.headers.get("X-GitHub-Delivery");
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return errorResponse("Invalid JSON payload", 400);
  }

  // Ping event (sent when webhook is first created)
  if (event === "ping") {
    return jsonResponse({ ok: true, message: "pong" });
  }

  // App lifecycle events arrive without an organization payload — handle them up front.
  if (event === "installation") {
    return await handleInstallationEvent(context.env.DB, payload, deliveryId);
  }
  if (event === "installation_repositories") {
    // Maintain installations.repos_json as the source of truth for which
    // repos are accessible. owner derived from the installation account
    // (payload.organization is absent on these events).
    const installationId = payload.installation?.id;
    const accountLogin = payload.installation?.account?.login;
    if (installationId) {
      try {
        const current = new Set(await getInstallationRepos(context.env.DB, installationId));
        for (const r of payload.repositories_added ?? []) {
          if (r?.full_name) current.add(r.full_name);
        }
        for (const r of payload.repositories_removed ?? []) {
          if (r?.full_name) current.delete(r.full_name);
        }
        await setInstallationRepos(context.env.DB, installationId, [...current]);
      } catch (err) {
        console.error("[unticket webhook] setInstallationRepos failed:", err);
      }
    }
    if (accountLogin) {
      try {
        await storeEvent(context.env.DB, event, deliveryId, payload, accountLogin);
      } catch (err) {
        console.error("[unticket webhook] storeEvent (installation_repositories) failed:", err);
      }
    }
    return jsonResponse({ ok: true, event, action: payload.action });
  }

  // Look up org
  const orgLogin = payload.organization?.login;
  if (!orgLogin) {
    return jsonResponse({ ok: true, skipped: "no organization in payload" });
  }

  const orgRow = await context.env.DB
    .prepare("SELECT id FROM orgs WHERE github_login = ?")
    .bind(orgLogin)
    .first();

  if (!orgRow) {
    return jsonResponse({ ok: true, skipped: "org not tracked" });
  }

  const orgId = orgRow.id;
  const db = context.env.DB;
  const action = payload.action;

  try {
    // Record into the events log first (additive — failure here must not
    // break the existing sprint-board upserts below). owner_id matches
    // NoxLink's text convention (org github_login).
    try {
      const stored = await storeEvent(db, event, deliveryId, payload, orgLogin);
      if (stored?.id) {
        // Narrate out-of-band so the webhook returns immediately.
        context.waitUntil(
          narrateEvent(context.env, stored.id).catch((err) => {
            console.error("[unticket narrator] narrateEvent failed:", err);
          })
        );
      }
    } catch (err) {
      console.error("[unticket webhook] storeEvent failed:", err);
    }

    if (event === "issues") {
      const repo = payload.repository?.name;
      if (!repo) return jsonResponse({ ok: true, skipped: "no repo" });

      const closedBy = (action === "closed" && payload.sender?.login) ? payload.sender.login : null;
      await upsertIssue(db, orgId, repo, payload.issue, closedBy);
      // Also upsert into features table if this is a unticket repo issue
      if (repo === "unticket") {
        await upsertFeature(db, orgId, payload.issue);
        // Re-sync pr_feature_links from metadata (atomic delete + re-insert)
        const { metadata } = parseFeatureMetadata(payload.issue.body ?? "");
        const linkedPRs = metadata.linkedPRs ?? [];
        const deleteStmt = db.prepare("DELETE FROM pr_feature_links WHERE org_id = ? AND feature_number = ? AND source = 'metadata'")
          .bind(orgId, payload.issue.number);
        if (linkedPRs.length > 0) {
          const linkStmt = db.prepare(
            `INSERT INTO pr_feature_links (org_id, feature_number, pr_repo, pr_number, source)
             VALUES (?, ?, ?, ?, 'metadata')
             ON CONFLICT(org_id, feature_number, pr_repo, pr_number) DO NOTHING`
          );
          await db.batch([deleteStmt, ...linkedPRs.map((l) => linkStmt.bind(orgId, payload.issue.number, l.repo, l.number))]);
        } else {
          await deleteStmt.run();
        }
      }
      return jsonResponse({ ok: true, event, action, repo, number: payload.issue.number });
    }

    if (event === "pull_request") {
      const repo = payload.repository?.name;
      if (!repo) return jsonResponse({ ok: true, skipped: "no repo" });

      // Map merged PRs: GitHub sends action=closed with merged=true
      const pr = payload.pull_request;
      await upsertPR(db, orgId, repo, pr);
      // Auto-detect feature links from branch name + PR body
      const linkStmt = db.prepare(
        `INSERT INTO pr_feature_links (org_id, feature_number, pr_repo, pr_number, source)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(org_id, feature_number, pr_repo, pr_number) DO NOTHING`
      );
      const linkBatch = [];
      const featureNumber = parseFeatureFromBranch(pr.head?.ref);
      if (featureNumber) {
        linkBatch.push(linkStmt.bind(orgId, featureNumber, repo, pr.number, "branch"));
      }
      for (const num of parseFeaturesFromBody(pr.body)) {
        linkBatch.push(linkStmt.bind(orgId, num, repo, pr.number, "body"));
      }
      if (linkBatch.length > 0) await db.batch(linkBatch);
      return jsonResponse({ ok: true, event, action, repo, number: pr.number });
    }

    // PR comments: detect feature links like "Part of unticket#42"
    if (event === "issue_comment" && payload.issue?.pull_request) {
      const repo = payload.repository?.name;
      const prNumber = payload.issue.number;

      if (action === "deleted") {
        // Clean up any links that were created from this comment's source
        if (repo) {
          await db.prepare(
            "DELETE FROM pr_feature_links WHERE org_id = ? AND pr_repo = ? AND pr_number = ? AND source = 'comment'"
          ).bind(orgId, repo, prNumber).run();
        }
        return jsonResponse({ ok: true, event: "pr_comment", action, cleaned: true });
      }

      // For created or edited comments, re-sync links
      const commentBody = payload.comment?.body;
      if (repo && commentBody) {
        if (action === "edited") {
          // Remove old comment-sourced links for this PR, then re-add
          await db.prepare(
            "DELETE FROM pr_feature_links WHERE org_id = ? AND pr_repo = ? AND pr_number = ? AND source = 'comment'"
          ).bind(orgId, repo, prNumber).run();
        }
        const featureNums = parseFeaturesFromBody(commentBody);
        if (featureNums.length > 0) {
          const linkStmt = db.prepare(
            `INSERT INTO pr_feature_links (org_id, feature_number, pr_repo, pr_number, source)
             VALUES (?, ?, ?, ?, 'comment')
             ON CONFLICT(org_id, feature_number, pr_repo, pr_number) DO NOTHING`
          );
          await db.batch(featureNums.map((num) => linkStmt.bind(orgId, num, repo, prNumber)));
        }
      }
      return jsonResponse({ ok: true, event: "pr_comment", action, linked: true });
    }

    if (event === "member") {
      const member = payload.member;
      if (!member?.login) {
        return jsonResponse({ ok: true, skipped: "no member in payload" });
      }
      if (action === "removed") {
        await removeMember(db, orgId, member.login);
      } else {
        await upsertMember(db, orgId, member);
      }
      return jsonResponse({ ok: true, event, action, login: member.login });
    }

    // Unhandled event — acknowledge it
    return jsonResponse({ ok: true, skipped: `unhandled event: ${event}` });
  } catch (e) {
    // Don't leak internal error details to webhook senders. Log server-side only.
    console.error("[unticket webhook]", event, action, e instanceof Error ? e.stack : e);
    return errorResponse("Webhook processing failed", 500);
  }
}

async function handleInstallationEvent(db, payload, deliveryId) {
  const action = payload.action;
  const installationId = payload.installation?.id;
  const accountLogin = payload.installation?.account?.login;
  if (!installationId || !accountLogin) {
    return jsonResponse({ ok: true, event: "installation", skipped: "missing installation/account" });
  }

  if (action === "created" || action === "new_permissions_accepted" || action === "unsuspend") {
    await db.batch([
      db.prepare(
        `INSERT INTO orgs (github_login, installation_id) VALUES (?, ?)
         ON CONFLICT(github_login) DO UPDATE SET installation_id = excluded.installation_id`
      ).bind(accountLogin, installationId),
      db.prepare(
        `UPDATE orgs SET installation_id = NULL
         WHERE installation_id = ? AND github_login != ?`
      ).bind(installationId, accountLogin),
    ]);
    try {
      // installation.created carries the initial repo list in payload.repositories.
      // Other actions don't, so we pass null and let COALESCE preserve it.
      const repos = action === "created" && Array.isArray(payload.repositories)
        ? JSON.stringify(payload.repositories.map((r) => r.full_name).filter(Boolean))
        : null;
      await upsertInstallation(db, payload.installation, repos);
      await storeEvent(db, "installation", deliveryId, payload, accountLogin);
    } catch (err) {
      console.error("[unticket webhook] installations sync failed:", err);
    }
    return jsonResponse({ ok: true, event: "installation", action, org: accountLogin });
  }

  if (action === "deleted" || action === "suspend") {
    await db
      .prepare("UPDATE orgs SET installation_id = NULL WHERE installation_id = ?")
      .bind(installationId)
      .run();
    try {
      await storeEvent(db, "installation", deliveryId, payload, accountLogin);
    } catch (err) {
      console.error("[unticket webhook] installation event log failed:", err);
    }
    return jsonResponse({ ok: true, event: "installation", action, org: accountLogin });
  }

  return jsonResponse({ ok: true, event: "installation", skipped: `unhandled action: ${action}` });
}
