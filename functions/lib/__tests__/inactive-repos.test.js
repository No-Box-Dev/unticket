import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getInactiveRepoSet,
  getUnticketRepoName,
  filterInactive,
  getActiveRepoNames,
} from "../inactive-repos.js";

// ---- D1 stub: small dispatch table mapping SQL substring → response.
// Tests pass in the four resource lists; everything else returns empty.

function makeDb({
  settings = null,        // object | string | null — what config.data holds
  archivedProjects = [],  // repo names where projects.archived = 1
  ghArchivedRepos = [],   // repo names where repos.archived_at IS NOT NULL
  allRepos = [],          // repo names in `repos`
} = {}) {
  function prepare(sql) {
    return {
      _sql: sql,
      bind() { return this; },
      async first() {
        if (sql.includes("FROM config")) {
          return settings === null ? null : { data: typeof settings === "string" ? settings : JSON.stringify(settings) };
        }
        return null;
      },
      async all() {
        if (sql.includes("FROM config")) {
          return {
            results: settings === null
              ? []
              : [{ data: typeof settings === "string" ? settings : JSON.stringify(settings) }],
          };
        }
        if (sql.includes("FROM projects")) {
          return { results: archivedProjects.map((repo) => ({ repo })) };
        }
        if (sql.includes("FROM repos WHERE org_id = ? AND archived_at IS NOT NULL")) {
          return { results: ghArchivedRepos.map((name) => ({ name })) };
        }
        if (sql.includes("FROM repos WHERE org_id = ?")) {
          return { results: allRepos.map((name) => ({ name })) };
        }
        return { results: [] };
      },
      async run() { return { meta: { changes: 0 } }; },
    };
  }
  return {
    prepare,
    async batch(stmts) {
      return Promise.all(stmts.map((s) => s.all()));
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("getInactiveRepoSet", () => {
  it("always excludes the default 'unticket' repo even with no settings", async () => {
    const db = makeDb();
    const set = await getInactiveRepoSet(db, 1, "acme");
    expect(set.has("unticket")).toBe(true);
  });

  it("respects a custom unticketRepo from settings", async () => {
    const db = makeDb({ settings: { unticketRepo: "config" } });
    const set = await getInactiveRepoSet(db, 1, "acme");
    expect(set.has("config")).toBe(true);
    expect(set.has("unticket")).toBe(false);
  });

  it("merges draftRepos, project archives, and GitHub archives", async () => {
    const db = makeDb({
      settings: { draftRepos: ["draft-a", "draft-b"] },
      archivedProjects: ["archived-proj"],
      ghArchivedRepos: ["gh-archived"],
    });
    const set = await getInactiveRepoSet(db, 1, "acme");
    expect([...set].sort()).toEqual(
      ["archived-proj", "draft-a", "draft-b", "gh-archived", "unticket"].sort(),
    );
  });

  it("throws loudly when settings JSON is corrupt", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = makeDb({ settings: "{not valid json" });
    await expect(getInactiveRepoSet(db, 7, "acme")).rejects.toThrow(/Corrupt settings JSON for org 7/);
    expect(errSpy).toHaveBeenCalled();
  });

  it("ignores blank or non-string unticketRepo (falls back to 'unticket')", async () => {
    const db = makeDb({ settings: { unticketRepo: "   " } });
    const set = await getInactiveRepoSet(db, 1, "acme");
    expect(set.has("unticket")).toBe(true);
  });

  it("trims surrounding whitespace from custom unticketRepo", async () => {
    const db = makeDb({ settings: { unticketRepo: "  cfg  " } });
    const set = await getInactiveRepoSet(db, 1, "acme");
    expect(set.has("cfg")).toBe(true);
  });
});

describe("getUnticketRepoName", () => {
  it("returns 'unticket' when no settings row exists", async () => {
    const db = makeDb();
    expect(await getUnticketRepoName(db, 1)).toBe("unticket");
  });

  it("returns the configured value when present", async () => {
    const db = makeDb({ settings: { unticketRepo: "cfg" } });
    expect(await getUnticketRepoName(db, 1)).toBe("cfg");
  });

  it("falls back to 'unticket' on blank values", async () => {
    const db = makeDb({ settings: { unticketRepo: "" } });
    expect(await getUnticketRepoName(db, 1)).toBe("unticket");
  });

  it("throws on corrupt settings JSON", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = makeDb({ settings: "{bad" });
    await expect(getUnticketRepoName(db, 9)).rejects.toThrow(/Corrupt settings JSON for org 9/);
  });
});

describe("filterInactive", () => {
  it("returns the input untouched for empty / nullish lists", async () => {
    const db = makeDb();
    expect(await filterInactive(db, 1, "acme", [])).toEqual([]);
    expect(await filterInactive(db, 1, "acme", null)).toEqual([]);
  });

  it("removes excluded repos from the list", async () => {
    const db = makeDb({ settings: { draftRepos: ["draft"] } });
    const out = await filterInactive(db, 1, "acme", ["api", "draft", "web", "unticket"]);
    expect(out).toEqual(["api", "web"]);
  });
});

describe("getActiveRepoNames", () => {
  it("returns repos minus everything in the inactive set", async () => {
    const db = makeDb({
      settings: { draftRepos: ["draft-a"] },
      archivedProjects: ["arc"],
      ghArchivedRepos: ["gh"],
      allRepos: ["api", "web", "draft-a", "arc", "gh", "unticket"],
    });
    const out = await getActiveRepoNames(db, 1, "acme");
    expect(out.sort()).toEqual(["api", "web"]);
  });

  it("returns [] when no repos exist", async () => {
    const db = makeDb();
    expect(await getActiveRepoNames(db, 1, "acme")).toEqual([]);
  });
});
