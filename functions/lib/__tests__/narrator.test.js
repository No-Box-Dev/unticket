import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../llm.js", () => ({
  completeNarrative: vi.fn(),
  NARRATOR_MODEL: "glm-5",
}));

import { narrateEvent, NARRATABLE_TYPES } from "../narrator.js";
import { completeNarrative } from "../llm.js";

// D1 stub: dispatch by SQL substring. Tests configure what each query returns
// and inspect _calls.runs/binds for the INSERT side effect.
function makeDb({ event = null, project = null, actor = null } = {}) {
  const calls = { firsts: [], runs: [] };
  function prepare(sql) {
    return {
      _sql: sql,
      _binds: [],
      bind(...binds) { this._binds = binds; return this; },
      async first() {
        calls.firsts.push({ sql, binds: this._binds });
        if (sql.includes("FROM events")) return event;
        if (sql.includes("FROM projects")) return project;
        if (sql.includes("FROM actors")) return actor;
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

beforeEach(() => completeNarrative.mockReset());
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
    const [apiKey, systemPrompt, userMessage] = completeNarrative.mock.calls[0];
    expect(apiKey).toBe("z-key");
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

describe("narrateEvent — payload parsing", () => {
  it("tolerates corrupt payload_json (treats as empty object)", async () => {
    const db = makeDb({
      event: { ...EVENT_ROW, payload_json: "not json" },
      project: PROJECT_ROW,
      actor: ACTOR_ROW,
    });
    completeNarrative.mockResolvedValue("ok");
    await narrateEvent(ENV(db), 1);
    expect(completeNarrative).toHaveBeenCalled();
  });

  it("tolerates null/empty payload_json", async () => {
    const db = makeDb({
      event: { ...EVENT_ROW, payload_json: null },
      project: PROJECT_ROW,
      actor: ACTOR_ROW,
    });
    completeNarrative.mockResolvedValue("ok");
    await narrateEvent(ENV(db), 1);
    expect(completeNarrative).toHaveBeenCalled();
  });

  it("treats non-object JSON (string/array) as empty object", async () => {
    const db = makeDb({
      event: { ...EVENT_ROW, payload_json: '"just a string"' },
      project: PROJECT_ROW,
      actor: ACTOR_ROW,
    });
    completeNarrative.mockResolvedValue("ok");
    await narrateEvent(ENV(db), 1);
    expect(completeNarrative).toHaveBeenCalled();
  });
});
