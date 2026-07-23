import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../crypto", () => ({
  decryptToken: vi.fn(async (encrypted) => `decrypted:${encrypted}`),
  encryptToken: vi.fn(async (plain) => `encrypted:${plain}`),
}));

import {
  buildOAuthAuthorizeUrl,
  SLACK_BOT_SCOPES,
  exchangeOAuthCode,
  signOAuthState,
  verifyOAuthState,
  resolveSlackInstall,
  resolveSlackChannels,
  postSlackMessage,
  listSlackChannels,
  buildPostsBlocks,
  buildReleaseNotesBlocks,
} from "../slack.js";

describe("buildOAuthAuthorizeUrl", () => {
  it("builds an authorize URL with the right scopes + state", () => {
    const url = buildOAuthAuthorizeUrl("client-123", "https://app.example.com", "state-xyz");
    expect(url).toContain("https://slack.com/oauth/v2/authorize");
    expect(url).toContain("client_id=client-123");
    expect(url).toContain("state=state-xyz");
    expect(url).toContain("channels%3Aread");
    expect(url).toContain("chat%3Awrite");
    expect(url).toContain(encodeURIComponent("https://app.example.com/api/slack/oauth/callback"));
  });
});

describe("Slack app manifest", () => {
  const manifest = JSON.parse(readFileSync(join(process.cwd(), "slack-app-manifest.json"), "utf8"));

  it("stays aligned with the OAuth flow and production endpoints", () => {
    expect(manifest.oauth_config.scopes.bot).toEqual(SLACK_BOT_SCOPES);
    expect(manifest.oauth_config.redirect_urls).toEqual([
      "https://app.unticket.ai/api/slack/oauth/callback",
    ]);
    expect(manifest.settings.event_subscriptions).toEqual({
      request_url: "https://app.unticket.ai/api/slack/events",
      bot_events: ["link_shared"],
    });
    expect(manifest.features.unfurl_domains).toEqual(["app.unticket.ai"]);
  });
});

describe("exchangeOAuthCode", () => {
  beforeEach(() => { globalThis.fetch = vi.fn(); });
  afterEach(() => vi.restoreAllMocks());

  it("returns bot token + team metadata on success", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        access_token: "xoxb-abc",
        bot_user_id: "U123",
        team: { id: "T999", name: "Acme" },
      }),
    });
    const result = await exchangeOAuthCode({
      clientId: "c", clientSecret: "s", code: "code1", redirectUri: "https://x/cb",
    });
    expect(result).toEqual({
      botToken: "xoxb-abc",
      botUserId: "U123",
      teamId: "T999",
      teamName: "Acme",
    });
  });

  it("throws when Slack returns ok=false", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, error: "invalid_code" }),
    });
    await expect(exchangeOAuthCode({ clientId: "c", clientSecret: "s", code: "x", redirectUri: "u" }))
      .rejects.toThrow(/invalid_code/);
  });

  it("throws when bot token is missing", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, team: { id: "T1" } }),
    });
    await expect(exchangeOAuthCode({ clientId: "c", clientSecret: "s", code: "x", redirectUri: "u" }))
      .rejects.toThrow(/no bot token/);
  });
});

describe("HMAC state signing", () => {
  it("round-trips a payload through sign + verify", async () => {
    const payload = "nonce-abc:42:alice";
    const sig = await signOAuthState("secret-1", payload);
    const verified = await verifyOAuthState("secret-1", `${payload}.${sig}`);
    expect(verified).toEqual({ orgId: 42, userLogin: "alice" });
  });

  it("rejects an unsigned state", async () => {
    expect(await verifyOAuthState("secret-1", "nonce:42:alice")).toBeNull();
  });

  it("rejects a state signed with a different secret", async () => {
    const payload = "nonce:42:alice";
    const sig = await signOAuthState("attacker-secret", payload);
    expect(await verifyOAuthState("real-secret", `${payload}.${sig}`)).toBeNull();
  });

  it("rejects a state where the attacker swapped the orgId", async () => {
    // Attacker has a valid signature for orgId=42, tampers it to 99.
    const payload = "nonce:42:alice";
    const sig = await signOAuthState("secret-1", payload);
    const tampered = `nonce:99:alice.${sig}`;
    expect(await verifyOAuthState("secret-1", tampered)).toBeNull();
  });

  it("rejects malformed states", async () => {
    expect(await verifyOAuthState("secret-1", "")).toBeNull();
    expect(await verifyOAuthState("secret-1", "no-dot")).toBeNull();
    expect(await verifyOAuthState("secret-1", "payload.")).toBeNull();
    expect(await verifyOAuthState("secret-1", null)).toBeNull();
  });

  it("rejects a state whose orgId isn't a positive integer", async () => {
    const payload = "nonce:not-a-number:alice";
    const sig = await signOAuthState("secret-1", payload);
    expect(await verifyOAuthState("secret-1", `${payload}.${sig}`)).toBeNull();
  });
});

describe("resolveSlackInstall", () => {
  function mkDb(row) {
    return { prepare: () => ({ bind: () => ({ first: async () => row }) }) };
  }
  it("returns null with no encryption key", async () => {
    const env = { DB: mkDb({ encrypted_bot_token: "enc" }) };
    expect(await resolveSlackInstall(env, "org-1")).toBeNull();
  });
  it("returns null when no row", async () => {
    const env = { DB: mkDb(null), ENCRYPTION_KEY: "k" };
    expect(await resolveSlackInstall(env, "org-1")).toBeNull();
  });
  it("decrypts + returns the install row", async () => {
    const env = {
      DB: mkDb({
        team_id: "T1",
        team_name: "Acme",
        bot_user_id: "U1",
        encrypted_bot_token: "enc",
      }),
      ENCRYPTION_KEY: "k",
    };
    expect(await resolveSlackInstall(env, "org-1")).toEqual({
      teamId: "T1",
      teamName: "Acme",
      botUserId: "U1",
      botToken: "decrypted:enc",
    });
  });
});

describe("resolveSlackChannels", () => {
  function mkDb(row) {
    return { prepare: () => ({ bind: () => ({ first: async () => row }) }) };
  }
  it("returns empty IDs when no settings", async () => {
    expect(await resolveSlackChannels(mkDb(null), "org-1")).toEqual({
      postsChannelId: "", releaseNotesChannelId: "",
    });
  });
  it("returns the configured channel IDs", async () => {
    const row = { data: JSON.stringify({ slack: { postsChannelId: "C1", releaseNotesChannelId: "C2" } }) };
    expect(await resolveSlackChannels(mkDb(row), "org-1")).toEqual({
      postsChannelId: "C1", releaseNotesChannelId: "C2",
    });
  });
  it("tolerates corrupt JSON", async () => {
    expect(await resolveSlackChannels(mkDb({ data: "not json" }), "org-1")).toEqual({
      postsChannelId: "", releaseNotesChannelId: "",
    });
  });
});

describe("postSlackMessage", () => {
  beforeEach(() => { globalThis.fetch = vi.fn(); });
  afterEach(() => vi.restoreAllMocks());

  it("POSTs to chat.postMessage with bearer auth + channel", async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true, ts: "1.2" }) });
    await postSlackMessage("xoxb-1", "C-123", { text: "hi", blocks: [] });
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toBe("https://slack.com/api/chat.postMessage");
    expect(init.headers.Authorization).toBe("Bearer xoxb-1");
    const body = JSON.parse(init.body);
    expect(body.channel).toBe("C-123");
    expect(body.text).toBe("hi");
  });

  it("throws when Slack returns ok=false", async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: false, error: "channel_not_found" }) });
    await expect(postSlackMessage("xoxb-1", "C-bad", {})).rejects.toThrow(/channel_not_found/);
  });
});

describe("listSlackChannels", () => {
  beforeEach(() => { globalThis.fetch = vi.fn(); });
  afterEach(() => vi.restoreAllMocks());

  it("returns sorted channels + handles pagination", async () => {
    globalThis.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        ok: true,
        channels: [{ id: "C2", name: "beta", is_private: false }],
        response_metadata: { next_cursor: "cur1" },
      })})
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        ok: true,
        channels: [{ id: "C1", name: "alpha", is_private: true }],
        response_metadata: { next_cursor: "" },
      })});
    const result = await listSlackChannels("xoxb-1");
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("alpha");
    expect(result[1].name).toBe("beta");
    expect(result[0].is_private).toBe(true);
  });
});

describe("buildPostsBlocks", () => {
  it("renders header + summary + action button", () => {
    const payload = buildPostsBlocks({
      actorName: "Jane",
      projectName: "unticket",
      summary: "I merged it.",
      prUrl: "https://github.com/x/y/pull/1",
      prNumber: 1,
      avatarUrl: "https://x/a.png",
    });
    expect(payload.blocks).toHaveLength(2);
    expect(payload.blocks[0].text.text).toContain("*Jane*");
    expect(payload.blocks[0].accessory.image_url).toBe("https://x/a.png");
    expect(payload.blocks[1].elements[0].url).toBe("https://github.com/x/y/pull/1");
  });

  it("escapes mrkdwn characters", () => {
    const payload = buildPostsBlocks({ actorName: "<x>", projectName: "&y", summary: "5 < 10" });
    expect(payload.blocks[0].text.text).toContain("&lt;x&gt;");
    expect(payload.blocks[0].text.text).toContain("&amp;y");
    expect(payload.blocks[0].text.text).toContain("5 &lt; 10");
  });
});

describe("buildReleaseNotesBlocks", () => {
  it("wraps the release note in a code fence", () => {
    const payload = buildReleaseNotesBlocks({ projectName: "u", summary: "🐛 #1 ..." });
    expect(payload.blocks[1].text.text.startsWith("```\n")).toBe(true);
    expect(payload.blocks[1].text.text.endsWith("\n```")).toBe(true);
  });

  it("sanitizes embedded ``` so a model can't close the fence", () => {
    const payload = buildReleaseNotesBlocks({
      projectName: "u",
      summary: "Bug.\n```python\nprint()\n```\nDone.",
    });
    const text = payload.blocks[1].text.text;
    const inner = text.slice(4, -4);
    expect(/`{3,}/.test(inner)).toBe(false);
  });
});
