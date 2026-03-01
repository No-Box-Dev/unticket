import { jsonResponse, errorResponse } from "../lib/db";
import { upsertIssue, upsertPR, upsertMember, removeMember } from "../lib/github-sync";

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

  // Constant-time comparison
  if (expected.length !== signature.length) return false;
  const a = encoder.encode(expected);
  const b = encoder.encode(signature);
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
  const payload = JSON.parse(body);

  // Ping event (sent when webhook is first created)
  if (event === "ping") {
    return jsonResponse({ ok: true, message: "pong" });
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
    if (event === "issues") {
      const repo = payload.repository?.name;
      if (!repo) return jsonResponse({ ok: true, skipped: "no repo" });

      await upsertIssue(db, orgId, repo, payload.issue);
      return jsonResponse({ ok: true, event, action, repo, number: payload.issue.number });
    }

    if (event === "pull_request") {
      const repo = payload.repository?.name;
      if (!repo) return jsonResponse({ ok: true, skipped: "no repo" });

      // Map merged PRs: GitHub sends action=closed with merged=true
      const pr = payload.pull_request;
      await upsertPR(db, orgId, repo, pr);
      return jsonResponse({ ok: true, event, action, repo, number: pr.number });
    }

    if (event === "member") {
      const member = payload.member;
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
    const message = e instanceof Error ? e.message : "Webhook processing failed";
    return errorResponse(message, 500);
  }
}
