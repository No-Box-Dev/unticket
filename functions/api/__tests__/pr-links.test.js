import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../lib/feature-metadata.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    readFeatureIssue: vi.fn(),
    updateFeatureBody: vi.fn(),
  };
});

import { onRequestGet, onRequestPost, onRequestDelete } from "../pr-links.js";
import { readFeatureIssue, updateFeatureBody } from "../../lib/feature-metadata.js";

// D1 stub that records `prepare(sql).bind(...).all()` and `.batch(stmts)` calls
// and returns canned results dispatched by SQL substring.
function makeDb({ rowsBySqlFragment = {} } = {}) {
  const calls = { all: [], run: [], batch: [], prepared: [] };
  function prepare(sql) {
    calls.prepared.push(sql);
    return {
      _sql: sql,
      _binds: [],
      bind(...binds) { this._binds = binds; return this; },
      async all() {
        calls.all.push({ sql, binds: this._binds });
        for (const [frag, results] of Object.entries(rowsBySqlFragment)) {
          if (sql.includes(frag)) return { results };
        }
        return { results: [] };
      },
      async run() {
        calls.run.push({ sql, binds: this._binds });
        return { meta: { changes: 0 } };
      },
    };
  }
  return {
    prepare,
    async batch(stmts) {
      calls.batch.push(stmts.map((s) => ({ sql: s._sql, binds: s._binds })));
      return stmts.map(() => ({ meta: { changes: 0 } }));
    },
    _calls: calls,
  };
}

function makeContext({ db, url, method = "GET", body, orgId = 1, orgLogin = "acme", token = "tok" }) {
  const req = body !== undefined
    ? new Request(url, { method, headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) })
    : new Request(url, { method });
  return { request: req, env: { DB: db }, data: { orgId, orgLogin, token } };
}

beforeEach(() => { readFeatureIssue.mockReset(); updateFeatureBody.mockReset(); });
afterEach(() => vi.restoreAllMocks());

describe("GET /api/pr-links?feature=N", () => {
  it("returns linked PRs joined with PR rows", async () => {
    const db = makeDb({
      rowsBySqlFragment: {
        "FROM pr_feature_links pfl": [
          { pr_repo: "api", pr_number: 100, source: "branch", pr_title: "Fix bug" },
        ],
      },
    });
    const res = await onRequestGet(makeContext({ db, url: "http://x/api/pr-links?feature=42" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { pr_repo: "api", pr_number: 100, source: "branch", pr_title: "Fix bug" },
    ]);
    expect(db._calls.all[0].binds).toEqual([1, 42]);
  });

  it("400s when feature is not a positive integer", async () => {
    const db = makeDb();
    const res = await onRequestGet(makeContext({ db, url: "http://x/api/pr-links?feature=-1" }));
    expect(res.status).toBe(400);
  });

  it("returns linked features for pr_repo+pr_number", async () => {
    const db = makeDb({
      rowsBySqlFragment: {
        "FROM pr_feature_links pfl": [
          { feature_number: 42, source: "manual", feature_title: "Login" },
        ],
      },
    });
    const res = await onRequestGet(makeContext({ db, url: "http://x/api/pr-links?pr_repo=api&pr_number=100" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { feature_number: 42, source: "manual", feature_title: "Login" },
    ]);
  });

  it("400s on invalid pr_repo", async () => {
    const db = makeDb();
    const res = await onRequestGet(makeContext({ db, url: "http://x/api/pr-links?pr_repo=bad%20name&pr_number=1" }));
    expect(res.status).toBe(400);
  });

  it("400s on invalid pr_number", async () => {
    const db = makeDb();
    const res = await onRequestGet(makeContext({ db, url: "http://x/api/pr-links?pr_repo=api&pr_number=abc" }));
    expect(res.status).toBe(400);
  });

  it("400s when neither query is provided", async () => {
    const db = makeDb();
    const res = await onRequestGet(makeContext({ db, url: "http://x/api/pr-links" }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/pr-links — link a PR to a feature", () => {
  it("400s on invalid feature_number", async () => {
    const db = makeDb();
    const res = await onRequestPost(makeContext({ db, url: "http://x/api/pr-links", method: "POST", body: { feature_number: -1, pr_repo: "api", pr_number: 1 } }));
    expect(res.status).toBe(400);
  });

  it("400s on invalid pr_repo", async () => {
    const db = makeDb();
    const res = await onRequestPost(makeContext({ db, url: "http://x/api/pr-links", method: "POST", body: { feature_number: 1, pr_repo: "bad name", pr_number: 1 } }));
    expect(res.status).toBe(400);
  });

  it("400s on invalid JSON body", async () => {
    const db = makeDb();
    const res = await onRequestPost(makeContext({ db, url: "http://x/api/pr-links", method: "POST", body: "not json" }));
    expect(res.status).toBe(400);
  });

  it("writes to GitHub then D1 when link is new", async () => {
    const db = makeDb();
    readFeatureIssue.mockResolvedValue({ body: "Plan\n" });
    updateFeatureBody.mockResolvedValue({});

    const res = await onRequestPost(makeContext({
      db,
      url: "http://x/api/pr-links",
      method: "POST",
      body: { feature_number: 42, pr_repo: "api", pr_number: 100 },
    }));
    expect(res.status).toBe(200);
    expect(updateFeatureBody).toHaveBeenCalledTimes(1);
    // Batch should include INSERT into pr_feature_links AND UPDATE features
    expect(db._calls.batch).toHaveLength(1);
    const batchSqls = db._calls.batch[0].map((b) => b.sql);
    expect(batchSqls.some((s) => s.includes("INSERT INTO pr_feature_links"))).toBe(true);
    expect(batchSqls.some((s) => s.includes("UPDATE features SET body"))).toBe(true);
  });

  it("skips GitHub PATCH when link already exists in metadata", async () => {
    const db = makeDb();
    readFeatureIssue.mockResolvedValue({
      body: `Plan\n\n<!-- unticket:metadata\n${JSON.stringify({ linkedPRs: [{ repo: "api", number: 100 }] })}\n-->`,
    });
    const res = await onRequestPost(makeContext({
      db,
      url: "http://x/api/pr-links",
      method: "POST",
      body: { feature_number: 42, pr_repo: "api", pr_number: 100 },
    }));
    expect(res.status).toBe(200);
    expect(updateFeatureBody).not.toHaveBeenCalled();
    // Batch still runs the INSERT (idempotent), but no UPDATE features.
    const batchSqls = db._calls.batch[0].map((b) => b.sql);
    expect(batchSqls.some((s) => s.includes("INSERT INTO pr_feature_links"))).toBe(true);
    expect(batchSqls.some((s) => s.includes("UPDATE features SET body"))).toBe(false);
  });
});

describe("DELETE /api/pr-links — unlink a PR from a feature", () => {
  it("400s on missing query params", async () => {
    const db = makeDb();
    const res = await onRequestDelete(makeContext({ db, url: "http://x/api/pr-links?feature=42", method: "DELETE" }));
    expect(res.status).toBe(400);
  });

  it("400s on bad feature value", async () => {
    const db = makeDb();
    const res = await onRequestDelete(makeContext({ db, url: "http://x/api/pr-links?feature=-1&pr_repo=api&pr_number=1", method: "DELETE" }));
    expect(res.status).toBe(400);
  });

  it("400s on bad pr_repo", async () => {
    const db = makeDb();
    const res = await onRequestDelete(makeContext({ db, url: "http://x/api/pr-links?feature=1&pr_repo=bad%20name&pr_number=1", method: "DELETE" }));
    expect(res.status).toBe(400);
  });

  it("removes the PR from metadata and D1 atomically", async () => {
    const db = makeDb();
    readFeatureIssue.mockResolvedValue({
      body: `Plan\n\n<!-- unticket:metadata\n${JSON.stringify({ linkedPRs: [{ repo: "api", number: 100 }, { repo: "api", number: 101 }] })}\n-->`,
    });
    updateFeatureBody.mockResolvedValue({});

    const res = await onRequestDelete(makeContext({
      db,
      url: "http://x/api/pr-links?feature=42&pr_repo=api&pr_number=100",
      method: "DELETE",
    }));
    expect(res.status).toBe(200);

    // The new body sent to GitHub should NOT contain pr 100 but should still
    // contain pr 101.
    const [, , , newBody] = updateFeatureBody.mock.calls[0];
    expect(newBody).not.toContain('"number":100');
    expect(newBody).toContain('"number":101');

    const batchSqls = db._calls.batch[0].map((b) => b.sql);
    expect(batchSqls.some((s) => s.includes("UPDATE features SET body"))).toBe(true);
    expect(batchSqls.some((s) => s.includes("DELETE FROM pr_feature_links"))).toBe(true);
  });
});
