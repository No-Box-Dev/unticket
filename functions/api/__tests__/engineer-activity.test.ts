import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/inactive-repos.js", () => ({
  getActiveRepoNames: vi.fn(),
}));

import { onRequestGet } from "../engineer-activity";
import { getActiveRepoNames } from "../../lib/inactive-repos.js";

const mockGetActiveRepoNames = vi.mocked(getActiveRepoNames);

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

beforeEach(() => mockGetActiveRepoNames.mockReset());

describe("GET /api/engineer-activity", () => {
  it("returns empty activity when the organization has no tracked repos", async () => {
    mockGetActiveRepoNames.mockResolvedValue([]);
    const db = makeDb();

    const response = await onRequestGet(makeContext(db));

    expect(await response.json()).toEqual({
      login: "alice",
      month: "2026-07",
      firstMonth: null,
      prsOpened: {},
      prsReviewed: {},
      monthlyOpened: {},
      monthlyReviewed: {},
    });
    expect(db._calls.batch).toHaveLength(0);
  });

  it("filters every activity query to tracked repos and returns daily and monthly data", async () => {
    mockGetActiveRepoNames.mockResolvedValue(["api", "web"]);
    const db = makeDb({
      batchResults: [
        { results: [{ k: "2026-07-03", c: 2 }] },
        { results: [{ k: "2026-06", c: 3 }, { k: "2026-07", c: 2 }] },
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
      prsReviewed: { "2026-07-04": 4 },
      monthlyOpened: { "2026-06": 3, "2026-07": 2 },
      monthlyReviewed: { "2026-05": 1, "2026-07": 4 },
    });

    const statements = db._calls.batch[0];
    expect(statements).toHaveLength(4);
    for (const statement of statements) {
      expect(statement.sql).toMatch(/repo IN \(\?,\?\)/);
      expect(statement.binds).toEqual(expect.arrayContaining(["api", "web"]));
    }
    expect(statements[2].sql).toContain("repo || '#'");
    expect(statements[2].sql).toContain("$.review.submitted_at");
    expect(statements[3].sql).toMatch(/GROUP BY k, repo, pr_number/);
  });

  it("returns PR activity without review queries when the login has no actor", async () => {
    mockGetActiveRepoNames.mockResolvedValue(["api"]);
    const db = makeDb({
      actorId: "",
      batchResults: [
        { results: [] },
        { results: [{ k: "2026-07", c: 1 }] },
      ],
    });

    const response = await onRequestGet(makeContext(db));
    expect(await response.json()).toMatchObject({
      firstMonth: "2026-07",
      prsReviewed: {},
      monthlyReviewed: {},
    });
    expect(db._calls.batch[0]).toHaveLength(2);
  });
});
