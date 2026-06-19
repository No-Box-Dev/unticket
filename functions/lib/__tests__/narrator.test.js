import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../llm.js", () => ({
  completeNarrative: vi.fn(),
  NARRATOR_MODEL: "glm-5",
}));
vi.mock("../op-failures.js", () => ({
  recordFailure: vi.fn(async () => {}),
}));
vi.mock("../slack.js", () => ({
  resolveSlackInstall: vi.fn(async () => null),
  resolveSlackChannels: vi.fn(async () => ({ postsChannelId: "", releaseNotesChannelId: "" })),
  postSlackMessage: vi.fn(async () => ({ ok: true })),
  buildPostsBlocks: vi.fn((args) => ({ blocks: ["post", args] })),
  buildReleaseNotesBlocks: vi.fn((args) => ({ blocks: ["release", args] })),
}));

import { narrateEvent, narrateReleaseNotes, NARRATABLE_TYPES } from "../narrator.js";
import { completeNarrative } from "../llm.js";
import { recordFailure } from "../op-failures.js";
import { RELEASE_NOTES_SYSTEM } from "../prompt.js";
import { resolveSlackInstall, resolveSlackChannels, postSlackMessage } from "../slack.js";

// D1 stub: dispatch by SQL substring. Tests configure what each query returns
// and inspect _calls.runs/binds for the INSERT side effect.
function makeDb({ event = null, project = null, actor = null, settings = null, existingReleaseNote = null, existingNarrative = null, org = { id: "org-1" } } = {}) {
  const calls = { firsts: [], runs: [] };
  function prepare(sql) {
    return {
      _sql: sql,
      _binds: [],
      bind(...binds) { this._binds = binds; return this; },
      async first() {
        calls.firsts.push({ sql, binds: this._binds });
        if (sql.includes("type = 'release_notes'")) return existingReleaseNote;
        if (sql.includes("type = 'narrative'")) return existingNarrative;
        if (sql.includes("FROM events")) return event;
        if (sql.includes("FROM projects")) return project;
        if (sql.includes("FROM actors")) return actor;
        if (sql.includes("FROM config")) return settings;
        if (sql.includes("FROM orgs")) return org;
        return null;
      },
      async run() {
        calls.runs.push({ sql, binds: this._binds });
        return { meta: { changes: 1 } };
      },
    };
  }
  return { prepare, _calls: calls };
}

const ENV = (db) => ({ DB: db, ZHIPU_API_KEY: "z-key" });

const EVENT_ROW = {
  id: 1,
  type: "github:pr:merged",
  actor_id: "actor-1",
  project_id: "proj-1",
  org: "no-box-dev",
  repo: "unticket",
  owner_id: "owner-1",
  summary: "PR #42: do thing",
  payload_json: JSON.stringify({ pr: { number: 42, title: "do thing" } }),
  created_at: "2026-05-17T10:00:00Z",
};

const PROJECT_ROW = { name: "unticket", narrator_enabled: 1 };
const ACTOR_ROW = { id: "actor-1", name: "Jane", tone: "Dry but warm" };

beforeEach(() => {
  completeNarrative.mockReset();
  recordFailure.mockClear();
  resolveSlackInstall.mockReset();
  resolveSlackInstall.mockResolvedValue(null);
  resolveSlackChannels.mockReset();
  resolveSlackChannels.mockResolvedValue({ postsChannelId: "", releaseNotesChannelId: "" });
  postSlackMessage.mockReset();
  postSlackMessage.mockResolvedValue({ ok: true });
});
afterEach(() => vi.restoreAllMocks());

describe("NARRATABLE_TYPES", () => {
  it("exports the narratable type list with pr:merged", () => {
    expect(NARRATABLE_TYPES).toContain("github:pr:merged");
  });
});

describe("narrateEvent — preconditions", () => {
  it("does nothing when the event row is missing", async () => {
    const db = makeDb();
    await narrateEvent(ENV(db), 999);
    expect(completeNarrative).not.toHaveBeenCalled();
    expect(db._calls.runs).toHaveLength(0);
  });

  it("skips events whose type is not narratable", async () => {
    const db = makeDb({ event: { ...EVENT_ROW, type: "github:pr:opened" } });
    await narrateEvent(ENV(db), 1);
    expect(completeNarrative).not.toHaveBeenCalled();
    expect(db._calls.runs).toHaveLength(0);
  });

  it("skips events missing actor_id", async () => {
    const db = makeDb({ event: { ...EVENT_ROW, actor_id: null } });
    await narrateEvent(ENV(db), 1);
    expect(completeNarrative).not.toHaveBeenCalled();
  });

  it("skips events missing project_id", async () => {
    const db = makeDb({ event: { ...EVENT_ROW, project_id: null } });
    await narrateEvent(ENV(db), 1);
    expect(completeNarrative).not.toHaveBeenCalled();
  });

  it("skips events missing owner_id", async () => {
    const db = makeDb({ event: { ...EVENT_ROW, owner_id: null } });
    await narrateEvent(ENV(db), 1);
    expect(completeNarrative).not.toHaveBeenCalled();
  });

  it("returns when project row is missing", async () => {
    const db = makeDb({ event: EVENT_ROW });
    await narrateEvent(ENV(db), 1);
    expect(completeNarrative).not.toHaveBeenCalled();
  });

  it("returns when project narrator is disabled (narrator_enabled = 0)", async () => {
    const db = makeDb({
      event: EVENT_ROW,
      project: { ...PROJECT_ROW, narrator_enabled: 0 },
    });
    await narrateEvent(ENV(db), 1);
    expect(completeNarrative).not.toHaveBeenCalled();
  });

  it("returns when actor row is missing", async () => {
    const db = makeDb({ event: EVENT_ROW, project: PROJECT_ROW });
    await narrateEvent(ENV(db), 1);
    expect(completeNarrative).not.toHaveBeenCalled();
  });
});

describe("narrateEvent — happy path", () => {
  it("calls completeNarrative with the actor system + built user message", async () => {
    const db = makeDb({ event: EVENT_ROW, project: PROJECT_ROW, actor: ACTOR_ROW });
    completeNarrative.mockResolvedValue("I merged the login button.");
    await narrateEvent(ENV(db), 1);
    expect(completeNarrative).toHaveBeenCalledTimes(1);
    const [config, systemPrompt, userMessage] = completeNarrative.mock.calls[0];
    expect(config).toMatchObject({
      provider: "anthropic",
      baseUrl: "https://api.z.ai/api/anthropic",
      apiKey: "z-key",
      model: "glm-5",
      source: "default",
    });
    expect(typeof systemPrompt).toBe("string");
    expect(systemPrompt.length).toBeGreaterThan(50);
    expect(userMessage).toContain("You are Jane.");
    expect(userMessage).toContain("Project: unticket");
  });

  it("inserts a narrative event with the LLM-generated summary and NARRATOR_MODEL", async () => {
    const db = makeDb({ event: EVENT_ROW, project: PROJECT_ROW, actor: ACTOR_ROW });
    completeNarrative.mockResolvedValue("I merged the login button.");
    await narrateEvent(ENV(db), 1);
    expect(db._calls.runs).toHaveLength(1);
    const run = db._calls.runs[0];
    expect(run.sql).toContain("INSERT INTO events");
    const [source, type, actorId, projId, org, repo, summary, payloadJson, ownerId, createdAt] = run.binds;
    expect(source).toBe("narrator");
    expect(type).toBe("narrative");
    expect(actorId).toBe("actor-1");
    expect(projId).toBe("proj-1");
    expect(org).toBe("no-box-dev");
    expect(repo).toBe("unticket");
    expect(summary).toBe("I merged the login button.");
    expect(ownerId).toBe("owner-1");
    expect(createdAt).toBe("2026-05-17T10:00:00Z");
    const payload = JSON.parse(payloadJson);
    expect(payload).toEqual({
      trigger_event_id: 1,
      trigger_type: "github:pr:merged",
      model: "glm-5",
      pr_number: 42,
    });
  });

  it("trims whitespace from the LLM output", async () => {
    const db = makeDb({ event: EVENT_ROW, project: PROJECT_ROW, actor: ACTOR_ROW });
    completeNarrative.mockResolvedValue("   spaced narrative   ");
    await narrateEvent(ENV(db), 1);
    expect(db._calls.runs[0].binds[6]).toBe("spaced narrative");
  });

  it("truncates output longer than 800 chars with an ellipsis", async () => {
    const db = makeDb({ event: EVENT_ROW, project: PROJECT_ROW, actor: ACTOR_ROW });
    completeNarrative.mockResolvedValue("x".repeat(900));
    await narrateEvent(ENV(db), 1);
    const summary = db._calls.runs[0].binds[6];
    expect(summary.length).toBe(800);
    expect(summary.endsWith("…")).toBe(true);
  });

  it("does not truncate output exactly 800 chars", async () => {
    const db = makeDb({ event: EVENT_ROW, project: PROJECT_ROW, actor: ACTOR_ROW });
    completeNarrative.mockResolvedValue("y".repeat(800));
    await narrateEvent(ENV(db), 1);
    const summary = db._calls.runs[0].binds[6];
    expect(summary.length).toBe(800);
    expect(summary.endsWith("…")).toBe(false);
  });
});

describe("narrateEvent — fallback path", () => {
  it("falls back to row.summary with model='fallback' when LLM returns null", async () => {
    const db = makeDb({ event: EVENT_ROW, project: PROJECT_ROW, actor: ACTOR_ROW });
    completeNarrative.mockResolvedValue(null);
    await narrateEvent(ENV(db), 1);
    expect(db._calls.runs).toHaveLength(1);
    const run = db._calls.runs[0];
    expect(run.binds[6]).toBe("PR #42: do thing");
    const payload = JSON.parse(run.binds[7]);
    expect(payload.model).toBe("fallback");
  });

  it("records an op_failures entry when LLM returns null", async () => {
    const db = makeDb({ event: EVENT_ROW, project: PROJECT_ROW, actor: ACTOR_ROW });
    completeNarrative.mockResolvedValue(null);
    await narrateEvent(ENV(db), 1);
    expect(recordFailure).toHaveBeenCalledTimes(1);
    const [, args] = recordFailure.mock.calls[0];
    expect(args).toMatchObject({
      ownerId: "owner-1",
      op: "narrateEvent",
      deliveryId: "event-1",
    });
    expect(args.error).toContain("default");
    expect(args.error).toContain("anthropic");
    expect(args.error).toContain("glm-5");
  });

  it("does NOT insert when LLM returns null AND row.summary is missing", async () => {
    const db = makeDb({
      event: { ...EVENT_ROW, summary: null },
      project: PROJECT_ROW,
      actor: ACTOR_ROW,
    });
    completeNarrative.mockResolvedValue(null);
    await narrateEvent(ENV(db), 1);
    expect(db._calls.runs).toHaveLength(0);
  });
});

describe("narrateEvent — idempotency", () => {
  it("skips when a narrative row already exists for the PR", async () => {
    const db = makeDb({
      event: EVENT_ROW,
      project: PROJECT_ROW,
      actor: ACTOR_ROW,
      existingNarrative: { id: 99 },
    });
    await narrateEvent(ENV(db), 1);
    expect(completeNarrative).not.toHaveBeenCalled();
    expect(db._calls.runs).toHaveLength(0);
  });

  it("dedups by (owner_id, repo, pr_number), not by trigger_event_id", async () => {
    // GitHub redelivers webhooks: same PR → new trigger event row with a
    // different id. The early-exit SELECT must bind on pr_number (42 from
    // EVENT_ROW.payload_json), not on row.id (1).
    const db = makeDb({ event: EVENT_ROW, project: PROJECT_ROW, actor: ACTOR_ROW });
    completeNarrative.mockResolvedValue("ok");
    await narrateEvent(ENV(db), 1);
    const dedupSelect = db._calls.firsts.find(
      (f) => f.sql.includes("type = 'narrative'") && f.sql.includes("pr_number"),
    );
    expect(dedupSelect).toBeDefined();
    expect(dedupSelect.binds).toEqual(["owner-1", "unticket", 42]);
  });

  it("uses INSERT ... ON CONFLICT DO NOTHING so concurrent writers can't double-insert", async () => {
    const db = makeDb({ event: EVENT_ROW, project: PROJECT_ROW, actor: ACTOR_ROW });
    completeNarrative.mockResolvedValue("ok");
    await narrateEvent(ENV(db), 1);
    const insert = db._calls.runs.find((r) => r.sql.includes("INSERT INTO events"));
    expect(insert.sql).toMatch(/ON CONFLICT\s+DO NOTHING/i);
  });

  it("skips the Slack mirror when the INSERT was suppressed by the unique index", async () => {
    // A concurrent narrator beat us to the row — D1 returns changes=0 from
    // ON CONFLICT DO NOTHING. The Slack mirror must not fire, otherwise the
    // same merged PR would post twice to the channel.
    const db = makeDb({ event: EVENT_ROW, project: PROJECT_ROW, actor: ACTOR_ROW });
    const realPrepare = db.prepare;
    db.prepare = (sql) => {
      const stmt = realPrepare(sql);
      if (sql.includes("INSERT INTO events")) {
        const orig = stmt.run.bind(stmt);
        stmt.run = async () => {
          await orig();
          return { meta: { changes: 0 } };
        };
      }
      return stmt;
    };
    resolveSlackInstall.mockResolvedValue({ teamId: "T1", botToken: "tok" });
    resolveSlackChannels.mockResolvedValue({ postsChannelId: "C1", releaseNotesChannelId: "" });
    completeNarrative.mockResolvedValue("ok");
    await narrateEvent(ENV(db), 1);
    expect(postSlackMessage).not.toHaveBeenCalled();
  });
});

describe("narrateReleaseNotes", () => {
  it("inserts a release_notes row when the LLM produces text", async () => {
    const db = makeDb({ event: EVENT_ROW, project: PROJECT_ROW, actor: ACTOR_ROW });
    completeNarrative.mockResolvedValue("🐛 unticket #42 Merged - Bugfix\nDetails: fixed the thing.");
    await narrateReleaseNotes(ENV(db), 1);
    const inserts = db._calls.runs.filter((r) => r.sql.includes("INSERT INTO events"));
    expect(inserts).toHaveLength(1);
    const [source, type] = inserts[0].binds;
    expect(source).toBe("release-notes");
    expect(type).toBe("release_notes");
  });

  it("uses the default system prompt when no override is configured", async () => {
    const db = makeDb({ event: EVENT_ROW, project: PROJECT_ROW, actor: ACTOR_ROW });
    completeNarrative.mockResolvedValue("ok");
    await narrateReleaseNotes(ENV(db), 1);
    const [, systemPrompt] = completeNarrative.mock.calls[0];
    expect(systemPrompt).toBe(RELEASE_NOTES_SYSTEM);
  });

  it("uses the admin override prompt from settings.releaseNotesPrompt", async () => {
    const db = makeDb({
      event: EVENT_ROW,
      project: PROJECT_ROW,
      actor: ACTOR_ROW,
      settings: { data: JSON.stringify({ releaseNotesPrompt: "CUSTOM RELEASE-NOTE VOICE" }) },
    });
    completeNarrative.mockResolvedValue("ok");
    await narrateReleaseNotes(ENV(db), 1);
    const [, systemPrompt] = completeNarrative.mock.calls[0];
    expect(systemPrompt).toBe("CUSTOM RELEASE-NOTE VOICE");
  });

  it("skips when a release_notes row already exists for the trigger", async () => {
    const db = makeDb({
      event: EVENT_ROW,
      project: PROJECT_ROW,
      actor: ACTOR_ROW,
      existingReleaseNote: { id: 99 },
    });
    await narrateReleaseNotes(ENV(db), 1);
    expect(completeNarrative).not.toHaveBeenCalled();
    expect(db._calls.runs).toHaveLength(0);
  });

  it("falls back to row.summary when the LLM fails and records op_failure", async () => {
    const db = makeDb({ event: EVENT_ROW, project: PROJECT_ROW, actor: ACTOR_ROW });
    completeNarrative.mockResolvedValue(null);
    await narrateReleaseNotes(ENV(db), 1);
    const insert = db._calls.runs.find((r) => r.sql.includes("INSERT INTO events"));
    expect(insert.binds[6]).toBe("PR #42: do thing");
    expect(JSON.parse(insert.binds[7]).model).toBe("fallback");
    expect(recordFailure).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ op: "narrateReleaseNotes" }),
    );
  });

  it("respects narrator_enabled=0 (same gate as narrateEvent)", async () => {
    const db = makeDb({
      event: EVENT_ROW,
      project: { ...PROJECT_ROW, narrator_enabled: 0 },
      actor: ACTOR_ROW,
    });
    await narrateReleaseNotes(ENV(db), 1);
    expect(completeNarrative).not.toHaveBeenCalled();
  });
});

// PR identity is the dedup unit (migration 0033). Narratable events
// (github:pr:merged) always carry pr.number, so a missing pr.number means
// either the row is corrupt or the event type is wrong — short-circuit
// rather than narrate a row we couldn't dedup later.
describe("narrateEvent — payload parsing", () => {
  it("short-circuits on corrupt payload_json (no pr.number means no dedup key)", async () => {
    const db = makeDb({
      event: { ...EVENT_ROW, payload_json: "not json" },
      project: PROJECT_ROW,
      actor: ACTOR_ROW,
    });
    completeNarrative.mockResolvedValue("ok");
    await narrateEvent(ENV(db), 1);
    expect(completeNarrative).not.toHaveBeenCalled();
  });

  it("short-circuits on null payload_json", async () => {
    const db = makeDb({
      event: { ...EVENT_ROW, payload_json: null },
      project: PROJECT_ROW,
      actor: ACTOR_ROW,
    });
    completeNarrative.mockResolvedValue("ok");
    await narrateEvent(ENV(db), 1);
    expect(completeNarrative).not.toHaveBeenCalled();
  });

  it("short-circuits on non-object JSON (string/array)", async () => {
    const db = makeDb({
      event: { ...EVENT_ROW, payload_json: '"just a string"' },
      project: PROJECT_ROW,
      actor: ACTOR_ROW,
    });
    completeNarrative.mockResolvedValue("ok");
    await narrateEvent(ENV(db), 1);
    expect(completeNarrative).not.toHaveBeenCalled();
  });

  it("narrates when payload carries pr.number (happy path for github:pr:merged)", async () => {
    const db = makeDb({ event: EVENT_ROW, project: PROJECT_ROW, actor: ACTOR_ROW });
    completeNarrative.mockResolvedValue("ok");
    await narrateEvent(ENV(db), 1);
    expect(completeNarrative).toHaveBeenCalled();
    // pr_number is denormalized into the narrative payload for the
    // PR-identity UNIQUE INDEX. Verify it's written.
    const insert = db._calls.runs.find((r) => r.sql.includes("INSERT INTO events"));
    expect(JSON.parse(insert.binds[7]).pr_number).toBe(42);
  });
});

describe("narrateEvent — Slack mirror", () => {
  it("does NOT post to Slack when no install + channel configured", async () => {
    const db = makeDb({ event: EVENT_ROW, project: PROJECT_ROW, actor: ACTOR_ROW });
    completeNarrative.mockResolvedValue("ok");
    await narrateEvent(ENV(db), 1);
    expect(postSlackMessage).not.toHaveBeenCalled();
  });

  it("does NOT post when install exists but the Posts channel is empty", async () => {
    const db = makeDb({ event: EVENT_ROW, project: PROJECT_ROW, actor: ACTOR_ROW });
    completeNarrative.mockResolvedValue("I merged it.");
    resolveSlackInstall.mockResolvedValue({ teamId: "T1", botToken: "xoxb-1" });
    resolveSlackChannels.mockResolvedValue({ postsChannelId: "", releaseNotesChannelId: "C2" });
    await narrateEvent(ENV(db), 1);
    expect(postSlackMessage).not.toHaveBeenCalled();
  });

  it("posts to the Posts channel after inserting a narrative", async () => {
    const db = makeDb({ event: EVENT_ROW, project: PROJECT_ROW, actor: ACTOR_ROW });
    completeNarrative.mockResolvedValue("I merged it.");
    resolveSlackInstall.mockResolvedValue({ teamId: "T1", botToken: "xoxb-1" });
    resolveSlackChannels.mockResolvedValue({ postsChannelId: "C1", releaseNotesChannelId: "" });
    await narrateEvent(ENV(db), 1);
    expect(postSlackMessage).toHaveBeenCalledTimes(1);
    expect(postSlackMessage.mock.calls[0][0]).toBe("xoxb-1");
    expect(postSlackMessage.mock.calls[0][1]).toBe("C1");
  });

  it("records op_failure but doesn't throw when Slack post fails", async () => {
    const db = makeDb({ event: EVENT_ROW, project: PROJECT_ROW, actor: ACTOR_ROW });
    completeNarrative.mockResolvedValue("I merged it.");
    resolveSlackInstall.mockResolvedValue({ teamId: "T1", botToken: "xoxb-1" });
    resolveSlackChannels.mockResolvedValue({ postsChannelId: "C1", releaseNotesChannelId: "" });
    postSlackMessage.mockRejectedValueOnce(new Error("Slack 500"));
    await expect(narrateEvent(ENV(db), 1)).resolves.toBeUndefined();
    expect(recordFailure).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ op: "slackPostNarrative" }),
    );
  });
});

describe("narrateReleaseNotes — Slack mirror", () => {
  it("posts to the Release-notes channel after inserting a release_notes row", async () => {
    const db = makeDb({ event: EVENT_ROW, project: PROJECT_ROW, actor: ACTOR_ROW });
    completeNarrative.mockResolvedValue("🐛 unticket #42 ...");
    resolveSlackInstall.mockResolvedValue({ teamId: "T1", botToken: "xoxb-1" });
    resolveSlackChannels.mockResolvedValue({ postsChannelId: "", releaseNotesChannelId: "C2" });
    await narrateReleaseNotes(ENV(db), 1);
    expect(postSlackMessage).toHaveBeenCalledTimes(1);
    expect(postSlackMessage.mock.calls[0][1]).toBe("C2");
  });

  it("does NOT post to Slack when the gate (narrator_enabled=0) blocks", async () => {
    const db = makeDb({
      event: EVENT_ROW,
      project: { ...PROJECT_ROW, narrator_enabled: 0 },
      actor: ACTOR_ROW,
    });
    resolveSlackInstall.mockResolvedValue({ teamId: "T1", botToken: "xoxb-1" });
    resolveSlackChannels.mockResolvedValue({ postsChannelId: "C1", releaseNotesChannelId: "C2" });
    await narrateReleaseNotes(ENV(db), 1);
    expect(postSlackMessage).not.toHaveBeenCalled();
  });
});
