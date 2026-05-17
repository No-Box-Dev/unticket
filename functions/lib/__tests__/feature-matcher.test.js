import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../llm.js", () => ({
  complete: vi.fn(),
}));

import { matchPRToFeatures } from "../feature-matcher.js";
import { complete } from "../llm.js";

// ---- D1 stub: dispatch keyed by SQL substring. Tests configure:
//   prior:       row returned for pr_match_attempts SELECT
//   existing:    row returned for pr_feature_links SELECT
//   features:    rows returned for the features SELECT
//   shouldThrow: SQL substrings → Error message, simulates D1 failures

function makeDb({ prior = null, existing = null, features = [], shouldThrow = {} } = {}) {
  const calls = { firsts: [], runs: [], batches: [] };

  function maybeThrow(sql) {
    for (const [needle, msg] of Object.entries(shouldThrow)) {
      if (sql.includes(needle)) throw new Error(msg);
    }
  }

  function prepare(sql) {
    return {
      _sql: sql,
      _binds: [],
      bind(...binds) { this._binds = binds; return this; },
      async first() {
        calls.firsts.push({ sql, binds: this._binds });
        maybeThrow(sql);
        if (sql.includes("FROM pr_match_attempts")) return prior;
        if (sql.includes("FROM pr_feature_links")) return existing;
        return null;
      },
      async all() {
        if (sql.includes("FROM features")) return { results: features };
        return { results: [] };
      },
      async run() {
        calls.runs.push({ sql, binds: this._binds });
        maybeThrow(sql);
        return { meta: { changes: 1 } };
      },
    };
  }

  return {
    prepare,
    async batch(stmts) {
      calls.batches.push(stmts.map((s) => ({ sql: s._sql, binds: s._binds })));
      return stmts.map(() => ({ meta: { changes: 1 } }));
    },
    _calls: calls,
  };
}

const ENV = (db) => ({ DB: db, ZHIPU_API_KEY: "z-key" });

const PR = {
  number: 100,
  title: "Add login button",
  body: "Closes the auth flow.",
  created_at: "2026-05-15T10:00:00Z",
  head: { ref: "feat/42-add-login" },
};

const FEATURE_ROWS = [
  { number: 42, title: "Login button", labels_json: "[]", created_at: "2026-05-10T00:00:00Z" },
  { number: 43, title: "Settings refresh", labels_json: "[]", created_at: "2026-05-12T00:00:00Z" },
];

beforeEach(() => complete.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("matchPRToFeatures — preconditions", () => {
  it("returns null when ZHIPU_API_KEY is missing", async () => {
    const db = makeDb();
    expect(await matchPRToFeatures({ DB: db }, 1, "api", PR)).toBeNull();
    expect(complete).not.toHaveBeenCalled();
  });

  it("returns null when pr.number is missing", async () => {
    const db = makeDb();
    expect(await matchPRToFeatures(ENV(db), 1, "api", {})).toBeNull();
    expect(complete).not.toHaveBeenCalled();
  });
});

describe("matchPRToFeatures — TTL skip", () => {
  it("returns null when a recent attempt is cached", async () => {
    const recent = new Date(Date.now() - 24 * 3600 * 1000).toISOString().replace("T", " ").replace(/\..*$/, "");
    const db = makeDb({ prior: { attempted_at: recent } });
    expect(await matchPRToFeatures(ENV(db), 1, "api", PR)).toBeNull();
    expect(complete).not.toHaveBeenCalled();
  });

  it("proceeds when the attempt is older than 168h", async () => {
    const old = new Date(Date.now() - 200 * 3600 * 1000).toISOString().replace("T", " ").replace(/\..*$/, "");
    const db = makeDb({
      prior: { attempted_at: old },
      features: FEATURE_ROWS,
    });
    complete.mockResolvedValue('{"feature_number":42}');
    const result = await matchPRToFeatures(ENV(db), 1, "api", PR);
    expect(result).toBe(42);
    expect(complete).toHaveBeenCalled();
  });

  it("treats a corrupt attempted_at as no cache (proceeds)", async () => {
    const db = makeDb({
      prior: { attempted_at: "not a date" },
      features: FEATURE_ROWS,
    });
    complete.mockResolvedValue('{"feature_number":null}');
    await matchPRToFeatures(ENV(db), 1, "api", PR);
    expect(complete).toHaveBeenCalled();
  });

  it("survives D1 failure on the attempt-lookup query (treats as no cache)", async () => {
    const db = makeDb({
      shouldThrow: { "FROM pr_match_attempts": "D1 boom" },
      features: FEATURE_ROWS,
    });
    complete.mockResolvedValue('{"feature_number":42}');
    const result = await matchPRToFeatures(ENV(db), 1, "api", PR);
    expect(result).toBe(42);
  });
});

describe("matchPRToFeatures — existing-link skip", () => {
  it("returns null when the PR already has any link", async () => {
    const db = makeDb({ existing: { 1: 1 } });
    expect(await matchPRToFeatures(ENV(db), 1, "api", PR)).toBeNull();
    expect(complete).not.toHaveBeenCalled();
  });
});

describe("matchPRToFeatures — date anchor (PR vs feature creation)", () => {
  it("rejects PRs with no created_at and records the reason", async () => {
    const db = makeDb({ features: FEATURE_ROWS });
    const noDatePR = { ...PR, created_at: null };
    expect(await matchPRToFeatures(ENV(db), 1, "api", noDatePR)).toBeNull();
    expect(complete).not.toHaveBeenCalled();
    expect(db._calls.runs.some((r) => r.binds.includes("no_pr_created_at"))).toBe(true);
  });

  it("filters out features that didn't exist when the PR was opened", async () => {
    const future = { number: 99, title: "Future feature", labels_json: "[]", created_at: "2026-06-01T00:00:00Z" };
    const db = makeDb({ features: [future, ...FEATURE_ROWS] });
    complete.mockResolvedValue('{"feature_number":42}');
    await matchPRToFeatures(ENV(db), 1, "api", PR);
    // The system message includes only candidates created before the PR.
    const userMessage = complete.mock.calls[0][1].user;
    expect(userMessage).not.toContain("#99");
    expect(userMessage).toContain("#42");
  });

  it("returns null + records 'no_features' when no candidates survive filtering", async () => {
    const futureOnly = { number: 99, title: "x", labels_json: "[]", created_at: "2026-06-01T00:00:00Z" };
    const db = makeDb({ features: [futureOnly] });
    expect(await matchPRToFeatures(ENV(db), 1, "api", PR)).toBeNull();
    expect(complete).not.toHaveBeenCalled();
    expect(db._calls.runs.some((r) => r.binds.includes("no_features"))).toBe(true);
  });

  it("filters out features labelled status:future even with a valid creation date", async () => {
    const backlogFeature = {
      number: 50,
      title: "Backlog item",
      labels_json: JSON.stringify([{ name: "status:future" }]),
      created_at: "2026-05-01T00:00:00Z",
    };
    const db = makeDb({ features: [backlogFeature, ...FEATURE_ROWS] });
    complete.mockResolvedValue('{"feature_number":42}');
    await matchPRToFeatures(ENV(db), 1, "api", PR);
    expect(complete.mock.calls[0][1].user).not.toContain("#50");
  });

  it("tolerates malformed labels_json (treats as no labels, keeps the feature)", async () => {
    const malformed = {
      number: 60,
      title: "Bad labels",
      labels_json: "not json",
      created_at: "2026-05-01T00:00:00Z",
    };
    const db = makeDb({ features: [malformed] });
    complete.mockResolvedValue('{"feature_number":60}');
    const result = await matchPRToFeatures(ENV(db), 1, "api", PR);
    expect(result).toBe(60);
  });
});

describe("matchPRToFeatures — LLM response parsing", () => {
  it("returns the matched feature when the LLM picks a valid candidate", async () => {
    const db = makeDb({ features: FEATURE_ROWS });
    complete.mockResolvedValue('{"feature_number":43}');
    expect(await matchPRToFeatures(ENV(db), 1, "api", PR)).toBe(43);
  });

  it("returns null + records 'no_match' when the LLM returns null", async () => {
    const db = makeDb({ features: FEATURE_ROWS });
    complete.mockResolvedValue('{"feature_number":null}');
    expect(await matchPRToFeatures(ENV(db), 1, "api", PR)).toBeNull();
    expect(db._calls.runs.some((r) => r.binds.includes("no_match"))).toBe(true);
  });

  it("rejects hallucinated feature numbers (LLM returns one not in candidates)", async () => {
    const db = makeDb({ features: FEATURE_ROWS });
    complete.mockResolvedValue('{"feature_number":9999}');
    expect(await matchPRToFeatures(ENV(db), 1, "api", PR)).toBeNull();
    expect(db._calls.runs.some((r) => r.binds.includes("no_match"))).toBe(true);
  });

  it("rejects non-integer / zero / negative LLM responses", async () => {
    const db = makeDb({ features: FEATURE_ROWS });
    for (const bad of ["{\"feature_number\":1.5}", "{\"feature_number\":0}", "{\"feature_number\":-3}"]) {
      complete.mockResolvedValueOnce(bad);
      expect(await matchPRToFeatures(ENV(db), 1, "api", PR)).toBeNull();
    }
  });

  it("rejects malformed / empty / non-string LLM responses", async () => {
    const db = makeDb({ features: FEATURE_ROWS });
    for (const bad of ["not json at all", "", "   ", null, undefined]) {
      complete.mockResolvedValueOnce(bad);
      expect(await matchPRToFeatures(ENV(db), 1, "api", PR)).toBeNull();
    }
  });
});

describe("matchPRToFeatures — successful match side effects", () => {
  it("writes the link + attempt rows in a single batch", async () => {
    const db = makeDb({ features: FEATURE_ROWS });
    complete.mockResolvedValue('{"feature_number":42}');
    await matchPRToFeatures(ENV(db), 1, "api", PR);
    expect(db._calls.batches).toHaveLength(1);
    const sqls = db._calls.batches[0].map((s) => s.sql);
    expect(sqls.some((s) => s.includes("INSERT INTO pr_feature_links"))).toBe(true);
    expect(sqls.some((s) => s.includes("INSERT INTO pr_match_attempts"))).toBe(true);
    expect(sqls.some((s) => s.includes("'llm'"))).toBe(true);
  });

  it("passes branch + truncated body to the LLM in the user message", async () => {
    const longBody = "x".repeat(2000);
    const db = makeDb({ features: FEATURE_ROWS });
    complete.mockResolvedValue('{"feature_number":42}');
    await matchPRToFeatures(ENV(db), 1, "api", { ...PR, body: longBody });
    const userMessage = complete.mock.calls[0][1].user;
    expect(userMessage).toContain('feat/42-add-login');
    // Body capped at 800 chars
    const descMatch = userMessage.match(/Description: (x+)/);
    expect(descMatch?.[1].length).toBe(800);
  });

  it("falls back to (empty) when the PR body is missing", async () => {
    const db = makeDb({ features: FEATURE_ROWS });
    complete.mockResolvedValue('{"feature_number":42}');
    await matchPRToFeatures(ENV(db), 1, "api", { ...PR, body: null });
    expect(complete.mock.calls[0][1].user).toContain("Description: (empty)");
  });

  it("includes the PR author + flags feature assignees matching the author", async () => {
    const featureWithAuthor = {
      number: 42,
      title: "Login button",
      labels_json: "[]",
      assignees_json: JSON.stringify([{ login: "alice" }, { login: "bob" }]),
      created_at: "2026-05-10T00:00:00Z",
    };
    const otherFeature = {
      number: 43,
      title: "Settings refresh",
      labels_json: "[]",
      assignees_json: JSON.stringify([{ login: "carol" }]),
      created_at: "2026-05-12T00:00:00Z",
    };
    const db = makeDb({ features: [featureWithAuthor, otherFeature] });
    complete.mockResolvedValue('{"feature_number":42}');
    await matchPRToFeatures(ENV(db), 1, "api", { ...PR, user: { login: "alice" } });
    const userMessage = complete.mock.calls[0][1].user;
    expect(userMessage).toContain("PR author: alice");
    expect(userMessage).toContain("alice (PR author)");
    expect(userMessage).toContain("bob");
    expect(userMessage).toContain("carol");
    // Only the matching assignee gets the (PR author) marker
    expect(userMessage).not.toContain("bob (PR author)");
    expect(userMessage).not.toContain("carol (PR author)");
  });

  it("omits the PR author line + marker when pr.user is missing", async () => {
    const db = makeDb({ features: FEATURE_ROWS });
    complete.mockResolvedValue('{"feature_number":42}');
    await matchPRToFeatures(ENV(db), 1, "api", PR);
    const userMessage = complete.mock.calls[0][1].user;
    expect(userMessage).not.toContain("PR author:");
    expect(userMessage).not.toContain("(PR author)");
  });

  it("tolerates malformed assignees_json (no assignee section emitted)", async () => {
    const bad = {
      number: 42,
      title: "Login button",
      labels_json: "[]",
      assignees_json: "not json",
      created_at: "2026-05-10T00:00:00Z",
    };
    const db = makeDb({ features: [bad] });
    complete.mockResolvedValue('{"feature_number":42}');
    await matchPRToFeatures(ENV(db), 1, "api", { ...PR, user: { login: "alice" } });
    const userMessage = complete.mock.calls[0][1].user;
    expect(userMessage).toContain("#42");
    expect(userMessage).not.toContain("assignees:");
  });
});
