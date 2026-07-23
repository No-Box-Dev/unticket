import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/github-sync.js", () => ({
  syncRepo: vi.fn(),
}));

import { onRequestPost } from "../recover-repo-history.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/recover-repo-history", () => {
  it("lists every repository in an explicitly accessible historical organization", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const page = new URL(url).searchParams.get("page");
      return new Response(JSON.stringify(page === "1"
        ? [
            { name: "old-api", archived: true },
            { name: "old-web", archived: false },
          ]
        : []), { status: 200 });
    }));

    const response = await onRequestPost({
      request: new Request("https://app.test/api/recover-repo-history?sourceOrg=acme-archive", {
        method: "POST",
      }),
      env: { DB: {} },
      data: {
        orgId: 1,
        orgLogin: "acme",
        token: "github-token",
        isAdmin: true,
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      done: false,
      cursor: "old-api",
      repoList: ["old-api", "old-web"],
      repos: 2,
      sourceOrg: "acme-archive",
      archivedRepos: 1,
    });
  });

  it("rejects invalid historical organization names before calling GitHub", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await onRequestPost({
      request: new Request("https://app.test/api/recover-repo-history?sourceOrg=bad_org", {
        method: "POST",
      }),
      env: { DB: {} },
      data: {
        orgId: 1,
        orgLogin: "acme",
        token: "github-token",
        isAdmin: true,
      },
    });

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts GitHub repository names containing dots and underscores", async () => {
    const calls = [];
    const db = {
      prepare(sql) {
        return {
          bind(...binds) {
            calls.push({ sql, binds });
            return this;
          },
          first: async () => null,
          run: async () => ({ meta: { changes: 1 } }),
        };
      },
    };
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).includes("/repos/acme-archive/n1.care_v2")) {
        return new Response(JSON.stringify({
          name: "n1.care_v2",
          owner: { login: "acme-archive" },
          archived: true,
          language: "TypeScript",
          pushed_at: "2026-01-01T00:00:00Z",
        }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }));

    const response = await onRequestPost({
      request: new Request(
        "https://app.test/api/recover-repo-history?sourceOrg=acme-archive&cursor=n1.care_v2",
        { method: "POST" },
      ),
      env: { DB: db },
      data: {
        orgId: 1,
        orgLogin: "acme",
        token: "github-token",
        isAdmin: true,
      },
    });

    expect(response.status).toBe(200);
    expect(calls.some(({ sql, binds }) =>
      sql.includes("INSERT INTO projects")
      && sql.includes("archived = 1")
      && binds.includes("n1.care_v2"),
    )).toBe(true);
  });
});
