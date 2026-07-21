import { describe, it, expect, vi } from "vitest";
import { onRequestPost, parseUnticketUrl } from "../slack/events.js";

// Fixed signing secret so tests can pre-compute valid signatures.
const SECRET = "signing-secret-fixture";

async function signBody(secret, timestamp, rawBody) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`v0:${timestamp}:${rawBody}`),
  );
  return "v0=" + [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function makeCtx({ body, timestamp, signature, env = {}, waitUntil = () => {} }) {
  const req = new Request("http://x/api/slack/events", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Slack-Request-Timestamp": timestamp,
      "X-Slack-Signature": signature,
    },
    body,
  });
  return { request: req, env, waitUntil: vi.fn(waitUntil) };
}

describe("parseUnticketUrl", () => {
  it("parses a PR URL", () => {
    expect(parseUnticketUrl("https://app.unticket.ai/prs/api/123")).toEqual({
      kind: "pr",
      repo: "api",
      number: 123,
    });
  });

  it("parses an issue URL", () => {
    expect(parseUnticketUrl("https://app.unticket.ai/issues/api/45")).toEqual({
      kind: "issue",
      repo: "api",
      number: 45,
    });
  });

  it("parses a feature deep-link", () => {
    expect(parseUnticketUrl("https://app.unticket.ai/?tab=sprint&f=7")).toEqual({
      kind: "feature",
      number: 7,
    });
  });

  it("returns null for non-unticket hosts", () => {
    expect(parseUnticketUrl("https://github.com/foo/bar/pull/1")).toBeNull();
  });

  it("returns null for unknown paths", () => {
    expect(parseUnticketUrl("https://app.unticket.ai/random/path")).toBeNull();
  });

  it("returns null when the PR number isn't a number", () => {
    expect(parseUnticketUrl("https://app.unticket.ai/prs/api/notanumber")).toBeNull();
  });
});

describe("onRequestPost — signature gating", () => {
  it("returns 200 no-op when SLACK_SIGNING_SECRET is missing (misconfig)", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ type: "url_verification", challenge: "x" });
    const ctx = makeCtx({ body, timestamp: ts, signature: "v0=deadbeef", env: {} });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);
  });

  it("rejects a request with a bad signature", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ type: "url_verification", challenge: "x" });
    const ctx = makeCtx({
      body,
      timestamp: ts,
      signature: "v0=wrong",
      env: { SLACK_SIGNING_SECRET: SECRET },
    });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(401);
  });

  it("rejects a stale timestamp even with a valid signature", async () => {
    const ts = String(Math.floor(Date.now() / 1000) - 60 * 60); // 1h old
    const body = JSON.stringify({ type: "url_verification", challenge: "x" });
    const sig = await signBody(SECRET, ts, body);
    const ctx = makeCtx({ body, timestamp: ts, signature: sig, env: { SLACK_SIGNING_SECRET: SECRET } });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(401);
  });

  it("echoes the challenge on url_verification", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ type: "url_verification", challenge: "abc123" });
    const sig = await signBody(SECRET, ts, body);
    const ctx = makeCtx({ body, timestamp: ts, signature: sig, env: { SLACK_SIGNING_SECRET: SECRET } });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("abc123");
  });

  it("acks event_callback and schedules work on waitUntil", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({
      type: "event_callback",
      team_id: "T1",
      event: {
        type: "link_shared",
        channel: "C1",
        message_ts: "1.0",
        links: [{ url: "https://app.unticket.ai/prs/api/1", domain: "app.unticket.ai" }],
      },
    });
    const sig = await signBody(SECRET, ts, body);
    const ctx = makeCtx({
      body,
      timestamp: ts,
      signature: sig,
      env: { SLACK_SIGNING_SECRET: SECRET, DB: null },
    });
    const res = await onRequestPost(ctx);
    expect(res.status).toBe(200);
    expect(ctx.waitUntil).toHaveBeenCalled();
  });
});
