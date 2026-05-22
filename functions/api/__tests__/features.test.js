import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { onRequestGet, onRequestPost } from "../features.js";
import {
  onRequestPatch,
  onRequestDelete,
} from "../features/[number].js";

function makeDb({ batchResults = [], firstResult = null, allResult = { results: [] }, runResult = { meta: { changes: 1 } } } = {}) {
  const calls = { batch: [], run: [], prepared: [], first: [], all: [] };
  function prepare(sql) {
    calls.prepared.push(sql);
    return {
      _sql: sql,
      _binds: [],
      bind(...binds) { this._binds = binds; return this; },
      async run() { calls.run.push({ sql, binds: this._binds }); return runResult; },
      async first() { calls.first.push({ sql, binds: this._binds }); return firstResult; },
      async all() { calls.all.push({ sql, binds: this._binds }); return allResult; },
    };
  }
  return {
    prepare,
    async batch(stmts) {
      calls.batch.push(stmts.map((s) => ({ sql: s._sql, binds: s._binds })));
      return batchResults;
    },
    _calls: calls,
  };
}

function makeCtx({
  db,
  url = "http://x/api/features",
  method = "GET",
  body,
  params,
  orgId = 1,
  orgLogin = "acme",
  token = "tok",
}) {
  const req = body !== undefined
    ? new Request(url, { method, headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) })
    : new Request(url, { method });
  return {
    request: req,
    env: { DB: db },
    data: { orgId, orgLogin, token },
    params: params ?? {},
  };
}

beforeEach(() => { global.fetch = vi.fn(); });
afterEach(() => vi.restoreAllMocks());

describe("GET /api/features", () => {
  it("hydrates linkedPRs from pr_feature_links (not body metadata)", async () => {
    const db = makeDb({
      batchResults: [
        { results: [
          { number: 42, title: "Login", state: "open", body: "Plan", assignees_json: '[]', labels_json: '[]' },
          { number: 43, title: "Signup", state: "open", body: "Plan", assignees_json: '[]', labels_json: '[]' },
        ] },
        { results: [
          { feature_number: 42, pr_repo: "api", pr_number: 100 },
          { feature_number: 42, pr_repo: "web", pr_number: 200 },
        ] },
      ],
    });
    const res = await onRequestGet(makeCtx({ db }));
    const data = await res.json();
    expect(data).toHaveLength(2);
    expect(data[0].linkedPRs).toEqual([{ repo: "api", number: 100 }, { repo: "web", number: 200 }]);
    expect(data[1].linkedPRs).toEqual([]);
  });

  it("filters by state from query param (default 'open')", async () => {
    const db = makeDb({ batchResults: [{ results: [] }, { results: [] }] });
    await onRequestGet(makeCtx({ db, url: "http://x/api/features?state=closed" }));
    expect(db._calls.batch[0][0].binds).toEqual([1, "closed"]);
  });
});

describe("POST /api/features", () => {
  it("400s on bad JSON", async () => {
    const res = await onRequestPost(makeCtx({ db: makeDb(), method: "POST", body: "{ broken" }));
    expect(res.status).toBe(400);
  });

  it("422s on empty title", async () => {
    const res = await onRequestPost(makeCtx({ db: makeDb(), method: "POST", body: { title: "" } }));
    expect(res.status).toBe(422);
  });

  it("422s on invalid status", async () => {
    const res = await onRequestPost(makeCtx({ db: makeDb(), method: "POST", body: { title: "X", status: "bogus" } }));
    expect(res.status).toBe(422);
  });

  it("creates issue on GitHub, mirrors to D1, returns Feature", async () => {
    // First fetch: ensureUnticketRepoLabels listing — return all labels present
    // so the create-label loop is a no-op.
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { name: "unticket" }, { name: "feature" },
          { name: "status:staging" }, { name: "status:ready" },
          { name: "status:production" }, { name: "status:future" },
        ],
      })
      // Second fetch: POST /issues
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          number: 7, title: "Login", state: "open",
          body: "plan\n\n<!-- unticket:metadata\n{}\n-->",
          assignees: [], labels: [{ name: "unticket", color: "1B6971" }, { name: "feature", color: "1B6971" }],
          html_url: "https://github.com/acme/unticket/issues/7",
          created_at: "t", updated_at: "t",
        }),
      });
    const db = makeDb({ allResult: { results: [] } });
    const res = await onRequestPost(makeCtx({
      db, method: "POST",
      body: { title: "Login", status: "todo", owners: ["alice"], plan: "plan" },
    }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBe(7);
    expect(data.title).toBe("Login");
    expect(data.status).toBe("todo");
    expect(db._calls.run).toHaveLength(1);  // upsert ran
  });

  it("400s when org context is missing", async () => {
    const res = await onRequestPost({
      request: new Request("http://x", { method: "POST", body: "{}" }),
      env: { DB: makeDb() },
      data: { orgId: 1 },  // no orgLogin / token
    });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/features/:number", () => {
  it("400s on bad number", async () => {
    const res = await onRequestPatch(makeCtx({ db: makeDb(), method: "PATCH", body: {}, params: { number: "abc" } }));
    expect(res.status).toBe(400);
  });

  it("404s when feature row is missing", async () => {
    const res = await onRequestPatch(makeCtx({
      db: makeDb({ firstResult: null }),
      method: "PATCH", body: {}, params: { number: "5" },
    }));
    expect(res.status).toBe(404);
  });

  it("422s on invalid status", async () => {
    const res = await onRequestPatch(makeCtx({
      db: makeDb({
        firstResult: {
          number: 5, title: "X", state: "open", body: "",
          assignees_json: "[]", labels_json: "[]", html_url: "u",
        },
      }),
      method: "PATCH", body: { status: "bogus" }, params: { number: "5" },
    }));
    expect(res.status).toBe(422);
  });

  it("appends statusHistory only when status actually changes", async () => {
    const initialBody = `do it\n\n<!-- unticket:metadata\n${JSON.stringify({
      statusHistory: [{ status: "todo", timestamp: "t1" }],
    })}\n-->`;
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        number: 5, title: "X", state: "open",
        body: "ignored", assignees: [],
        labels: [{ name: "unticket", color: "1B6971" }, { name: "feature", color: "1B6971" },
                 { name: "status:staging", color: "B89464" }],
        html_url: "u", created_at: "t", updated_at: "t",
      }),
    });
    const db = makeDb({
      firstResult: {
        number: 5, title: "X", state: "open", body: initialBody,
        assignees_json: "[]", labels_json: JSON.stringify([{ name: "unticket" }, { name: "feature" }]),
        html_url: "u",
      },
      allResult: { results: [] },
    });
    const res = await onRequestPatch(makeCtx({
      db, method: "PATCH",
      body: { status: "staging" }, params: { number: "5" },
    }));
    expect(res.status).toBe(200);
    // Inspect the body sent to GitHub
    const ghCall = global.fetch.mock.calls[0];
    const ghBody = JSON.parse(ghCall[1].body);
    expect(ghBody.labels).toEqual(["unticket", "feature", "status:staging"]);
    const meta = JSON.parse(ghBody.body.match(/<!-- unticket:metadata\n([\s\S]+)\n-->/)[1]);
    expect(meta.statusHistory).toHaveLength(2);
    expect(meta.statusHistory[1].status).toBe("staging");
  });

  it("does not append statusHistory when status is unchanged", async () => {
    const initialBody = `do it\n\n<!-- unticket:metadata\n${JSON.stringify({
      statusHistory: [{ status: "todo", timestamp: "t1" }],
    })}\n-->`;
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        number: 5, title: "New title", state: "open",
        body: "ignored", assignees: [], labels: [],
        html_url: "u", created_at: "t", updated_at: "t",
      }),
    });
    const db = makeDb({
      firstResult: {
        number: 5, title: "X", state: "open", body: initialBody,
        assignees_json: "[]", labels_json: JSON.stringify([{ name: "unticket" }, { name: "feature" }]),
        html_url: "u",
      },
      allResult: { results: [] },
    });
    await onRequestPatch(makeCtx({
      db, method: "PATCH",
      body: { title: "New title" }, params: { number: "5" },
    }));
    const ghCall = global.fetch.mock.calls[0];
    const ghBody = JSON.parse(ghCall[1].body);
    const meta = JSON.parse(ghBody.body.match(/<!-- unticket:metadata\n([\s\S]+)\n-->/)[1]);
    expect(meta.statusHistory).toHaveLength(1);
  });

  it("rejects invalid owner usernames", async () => {
    const db = makeDb({
      firstResult: {
        number: 5, title: "X", state: "open", body: "",
        assignees_json: "[]", labels_json: "[]", html_url: "u",
      },
      allResult: { results: [] },
    });
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        number: 5, title: "X", state: "open", body: "",
        assignees: [], labels: [], html_url: "u", created_at: "t", updated_at: "t",
      }),
    });
    await onRequestPatch(makeCtx({
      db, method: "PATCH",
      body: { owners: ["alice", "bad name", "../etc"] },
      params: { number: "5" },
    }));
    const ghCall = global.fetch.mock.calls[0];
    const ghBody = JSON.parse(ghCall[1].body);
    expect(ghBody.assignees).toEqual(["alice"]);  // invalid usernames stripped
  });
});

describe("DELETE /api/features/:number", () => {
  it("400s on bad number", async () => {
    const res = await onRequestDelete(makeCtx({ db: makeDb(), method: "DELETE", params: { number: "abc" } }));
    expect(res.status).toBe(400);
  });

  it("404s when feature row is missing", async () => {
    const res = await onRequestDelete(makeCtx({
      db: makeDb({ firstResult: null }),
      method: "DELETE", params: { number: "5" },
    }));
    expect(res.status).toBe(404);
  });

  it("closes issue, keeps user labels, strips unticket/feature/status:* labels", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        number: 5, title: "X", state: "closed", body: "",
        assignees: [], labels: [{ name: "bug" }],
        html_url: "u", created_at: "t", updated_at: "t",
      }),
    });
    const db = makeDb({
      firstResult: {
        number: 5, title: "X", state: "open", body: "",
        assignees_json: "[]",
        labels_json: JSON.stringify([
          { name: "unticket" }, { name: "feature" },
          { name: "status:ready" }, { name: "bug" },
        ]),
        html_url: "u",
      },
    });
    const res = await onRequestDelete(makeCtx({ db, method: "DELETE", params: { number: "5" } }));
    expect(res.status).toBe(200);
    const ghCall = global.fetch.mock.calls[0];
    const ghBody = JSON.parse(ghCall[1].body);
    expect(ghBody.state).toBe("closed");
    expect(ghBody.labels).toEqual(["bug"]);
  });
});
