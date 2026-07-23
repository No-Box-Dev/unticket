import { describe, expect, it } from "vitest";

import { onRequestGet } from "../engineer-activity";

function makeDb({ actorId = "actor-1", batchResults = [] as { results: unknown[] }[] } = {}) {
  const calls = { batch: [] as { sql: string; binds: unknown[] }[][] };
  return {
    prepare(sql: string) {
      return {
        _sql: sql,
        _binds: [] as unknown[],
        bind(...binds: unknown[]) {
          this._binds = binds;
          return this;
        },
        async first() {
          return actorId ? { id: actorId } : null;
        },
      };
    },
    async batch(statements: { _sql: string; _binds: unknown[] }[]) {
      calls.batch.push(statements.map((statement) => ({ sql: statement._sql, binds: statement._binds })));
      return batchResults;
    },
    _calls: calls,
  };
}

function makeContext(db: ReturnType<typeof makeDb>, url = "http://x/api/engineer-activity?login=alice&month=2026-07") {
  return {
    request: new Request(url),
    env: { DB: db },
    data: { orgId: 7, orgLogin: "acme" },
  } as never;
}

describe("GET /api/engineer-activity", () => {
  it("filters every activity query through tracking periods and returns daily and monthly data", async () => {
    const db = makeDb({
      batchResults: [
        { results: [{ k: "2026-07-03", c: 2 }] },
        { results: [{ k: "2026-06", c: 3 }, { k: "2026-07", c: 2 }] },
        { results: [{ k: "2026-07-05", c: 1 }] },
        { results: [{ k: "2026-06", c: 2 }, { k: "2026-07", c: 1 }] },
        { results: [{ k: "2026-07-04", c: 4 }] },
        { results: [{ k: "2026-05", c: 1 }, { k: "2026-07", c: 4 }] },
      ],
    });

    const response = await onRequestGet(makeContext(db));
    const body = await response.json();

    expect(body).toEqual({
      login: "alice",
      month: "2026-07",
      firstMonth: "2026-05",
      prsOpened: { "2026-07-03": 2 },
      prsMerged: { "2026-07-05": 1 },
      prsReviewed: { "2026-07-04": 4 },
      monthlyOpened: { "2026-06": 3, "2026-07": 2 },
      monthlyMerged: { "2026-06": 2, "2026-07": 1 },
      monthlyReviewed: { "2026-05": 1, "2026-07": 4 },
    });

    const statements = db._calls.batch[0];
    expect(statements).toHaveLength(6);
    for (const statement of statements) {
      expect(statement.sql).toContain("repo_tracking_periods");
    }
    expect(statements[4].sql).toContain("repo || '#'");
    expect(statements[4].sql).toContain("$.review.submitted_at");
    expect(statements[5].sql).toMatch(/GROUP BY k, repo, pr_number/);
  });

  it("returns PR activity without review queries when the login has no actor", async () => {
    const db = makeDb({
      actorId: "",
      batchResults: [
        { results: [] },
        { results: [{ k: "2026-07", c: 1 }] },
        { results: [] },
        { results: [] },
      ],
    });

    const response = await onRequestGet(makeContext(db));
    expect(await response.json()).toMatchObject({
      firstMonth: "2026-07",
      prsReviewed: {},
      monthlyReviewed: {},
    });
    expect(db._calls.batch[0]).toHaveLength(4);
  });
});
