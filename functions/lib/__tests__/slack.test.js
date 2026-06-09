import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isValidSlackWebhookUrl,
  postToSlack,
  resolveSlackSettings,
  buildPostsBlocks,
  buildReleaseNotesBlocks,
} from "../slack.js";

describe("isValidSlackWebhookUrl", () => {
  it("accepts https://hooks.slack.com URLs", () => {
    expect(isValidSlackWebhookUrl("https://hooks.slack.com/services/T1/B2/abc")).toBe(true);
  });
  it("rejects non-Slack hostnames", () => {
    expect(isValidSlackWebhookUrl("https://evil.com/hook")).toBe(false);
  });
  it("rejects http (must be https)", () => {
    expect(isValidSlackWebhookUrl("http://hooks.slack.com/services/T/B/abc")).toBe(false);
  });
  it("rejects empty / non-string", () => {
    expect(isValidSlackWebhookUrl("")).toBe(false);
    expect(isValidSlackWebhookUrl(null)).toBe(false);
    expect(isValidSlackWebhookUrl(undefined)).toBe(false);
  });
  it("rejects malformed URLs", () => {
    expect(isValidSlackWebhookUrl("not a url")).toBe(false);
  });
});

describe("postToSlack", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws when the URL is not a Slack webhook", async () => {
    await expect(postToSlack("https://evil.com/x", {})).rejects.toThrow(/Invalid Slack webhook/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("POSTs JSON to the webhook URL", async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, status: 200, text: async () => "ok" });
    await postToSlack("https://hooks.slack.com/services/T/B/abc", { text: "hi" });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toBe("https://hooks.slack.com/services/T/B/abc");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({ text: "hi" });
  });

  it("throws on non-2xx with status + body excerpt", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: async () => "channel_not_found",
    });
    await expect(postToSlack("https://hooks.slack.com/services/T/B/abc", {})).rejects.toThrow(
      /Slack 403 Forbidden: channel_not_found/,
    );
  });
});

describe("resolveSlackSettings", () => {
  function makeDb(row) {
    return {
      prepare: () => ({
        bind: () => ({ first: async () => row }),
      }),
    };
  }

  it("returns empty URLs when no settings row exists", async () => {
    const settings = await resolveSlackSettings(makeDb(null), "org-1");
    expect(settings).toEqual({ postsWebhookUrl: "", releaseNotesWebhookUrl: "" });
  });

  it("returns empty URLs when slack key is missing", async () => {
    const row = { data: JSON.stringify({ unticketRepo: "unticket" }) };
    const settings = await resolveSlackSettings(makeDb(row), "org-1");
    expect(settings).toEqual({ postsWebhookUrl: "", releaseNotesWebhookUrl: "" });
  });

  it("returns trimmed URLs from the settings row", async () => {
    const row = {
      data: JSON.stringify({
        slack: {
          postsWebhookUrl: "  https://hooks.slack.com/posts  ",
          releaseNotesWebhookUrl: "https://hooks.slack.com/notes",
        },
      }),
    };
    const settings = await resolveSlackSettings(makeDb(row), "org-1");
    expect(settings).toEqual({
      postsWebhookUrl: "https://hooks.slack.com/posts",
      releaseNotesWebhookUrl: "https://hooks.slack.com/notes",
    });
  });

  it("tolerates corrupt JSON", async () => {
    const settings = await resolveSlackSettings(makeDb({ data: "not json" }), "org-1");
    expect(settings).toEqual({ postsWebhookUrl: "", releaseNotesWebhookUrl: "" });
  });
});

describe("buildPostsBlocks", () => {
  it("renders header + summary with a PR action button", () => {
    const payload = buildPostsBlocks({
      actorName: "Jane",
      projectName: "unticket",
      summary: "I merged the login button.",
      prUrl: "https://github.com/no-box-dev/unticket/pull/42",
      prNumber: 42,
      avatarUrl: "https://example.com/jane.png",
    });
    expect(payload.blocks).toHaveLength(2);
    expect(payload.blocks[0].type).toBe("section");
    expect(payload.blocks[0].text.text).toContain("*Jane*");
    expect(payload.blocks[0].text.text).toContain("`unticket`");
    expect(payload.blocks[0].text.text).toContain("I merged the login button.");
    expect(payload.blocks[0].accessory?.image_url).toBe("https://example.com/jane.png");
    expect(payload.blocks[1].type).toBe("actions");
    expect(payload.blocks[1].elements[0].url).toBe("https://github.com/no-box-dev/unticket/pull/42");
    expect(payload.blocks[1].elements[0].text.text).toBe("View PR #42");
  });

  it("omits the action button when no PR url is given", () => {
    const payload = buildPostsBlocks({
      actorName: "Jane",
      projectName: "unticket",
      summary: "hello",
    });
    expect(payload.blocks).toHaveLength(1);
  });

  it("escapes &, <, > in summary and names to prevent mrkdwn injection", () => {
    const payload = buildPostsBlocks({
      actorName: "<script>",
      projectName: "&repo",
      summary: "5 < 10 & true",
    });
    expect(payload.blocks[0].text.text).toContain("&lt;script&gt;");
    expect(payload.blocks[0].text.text).toContain("&amp;repo");
    expect(payload.blocks[0].text.text).toContain("5 &lt; 10 &amp; true");
  });
});

describe("buildReleaseNotesBlocks", () => {
  it("wraps the structured release note in a code fence to preserve formatting", () => {
    const note = "🐛 unticket #42 Merged - Bugfix\nRepository: unticket\nDetails: ...";
    const payload = buildReleaseNotesBlocks({ projectName: "unticket", summary: note, prUrl: "https://x", prNumber: 42 });
    expect(payload.blocks[0].text.text).toContain("*Release note*");
    expect(payload.blocks[1].text.text.startsWith("```\n")).toBe(true);
    expect(payload.blocks[1].text.text.endsWith("\n```")).toBe(true);
    expect(payload.blocks[1].text.text).toContain("🐛 unticket #42");
  });

  it("truncates summaries longer than ~2800 chars", () => {
    const long = "x".repeat(3500);
    const payload = buildReleaseNotesBlocks({ projectName: "u", summary: long });
    expect(payload.blocks[1].text.text.length).toBeLessThan(2820);
    expect(payload.blocks[1].text.text).toContain("…");
  });

  it("sanitizes embedded ``` so a model can't close the wrapping code fence", () => {
    const payload = buildReleaseNotesBlocks({
      projectName: "u",
      summary: "Type: Bugfix\n```python\nprint('hi')\n```\nDone.",
    });
    const text = payload.blocks[1].text.text;
    // Outer fence still wraps the whole thing
    expect(text.startsWith("```\n")).toBe(true);
    expect(text.endsWith("\n```")).toBe(true);
    // The inner ``` runs are broken up so they no longer form fences. We
    // assert: between the outer opener and closer, no three consecutive
    // backticks survive (only the outer pair would).
    const inner = text.slice(4, -4);
    expect(/`{3,}/.test(inner)).toBe(false);
  });
});
