import { describe, expect, it } from "vitest";
import { renameRepoTracking, startRepoTracking, stopRepoTracking } from "../repo-tracking.js";

function makeDb() {
  const calls = [];
  return {
    prepare(sql) {
      return {
        bind(...binds) {
          return {
            async run() {
              calls.push({ sql, binds });
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
    calls,
  };
}

describe("repository tracking periods", () => {
  it("opens a period idempotently", async () => {
    const db = makeDb();
    await startRepoTracking(db, 7, "api", "2026-01-01T00:00:00Z");
    expect(db.calls[0].sql).toContain("WHERE NOT EXISTS");
    expect(db.calls[0].binds).toEqual([
      7,
      "api",
      "2026-01-01T00:00:00Z",
      7,
      "api",
    ]);
  });

  it("closes only the currently-open period with a reason", async () => {
    const db = makeDb();
    await stopRepoTracking(db, 7, "api", "transferred", "2026-02-01T00:00:00Z");
    expect(db.calls[0].sql).toContain("tracked_until IS NULL");
    expect(db.calls[0].binds).toEqual([
      "2026-02-01T00:00:00Z",
      "transferred",
      7,
      "api",
    ]);
  });

  it("carries all periods across a repository rename", async () => {
    const db = makeDb();
    await renameRepoTracking(db, 7, "old", "new");
    expect(db.calls[0].binds).toEqual(["new", 7, "old"]);
  });
});
