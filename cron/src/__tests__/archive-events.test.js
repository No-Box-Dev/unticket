import { describe, it, expect, vi } from "vitest";
import { archiveOldEvents, RETENTION_DAYS } from "../archive-events.js";

// DB stub: returns each queued SELECT batch in turn, records DELETE binds.
function makeDb(selectBatches) {
  let i = 0;
  const deletes = [];
  return {
    _deletes: deletes,
    prepare(sql) {
      return {
        sql,
        binds: [],
        bind(...b) { this.binds = b; return this; },
        async all() { return { results: selectBatches[i++] ?? [] }; },
        async run() { if (sql.includes("DELETE")) deletes.push(this.binds); return {}; },
      };
    },
  };
}

const NOW = Date.parse("2026-06-01T03:00:00.000Z");

describe("archiveOldEvents", () => {
  it("writes a batch to R2 as NDJSON then deletes it", async () => {
    const rows = [
      { id: 1, type: "github:pr:merged", created_at: "2026-01-01T00:00:00Z" },
      { id: 2, type: "github:push", created_at: "2026-01-02T00:00:00Z" },
    ];
    const put = vi.fn();
    const db = makeDb([rows, []]);
    const result = await archiveOldEvents({ DB: db, EVENTS_ARCHIVE: { put } }, NOW);

    expect(result).toEqual({ archived: 2 });
    expect(put).toHaveBeenCalledOnce();
    const [key, body] = put.mock.calls[0];
    expect(key).toBe("events/2026-06-01/1-2.ndjson");
    expect(body).toBe(JSON.stringify(rows[0]) + "\n" + JSON.stringify(rows[1]) + "\n");
    // Deleted up to the batch's max id, guarded by the cutoff.
    expect(db._deletes).toHaveLength(1);
    expect(db._deletes[0][0]).toBe(2); // maxId
  });

  it("uses a cutoff RETENTION_DAYS before now", async () => {
    const put = vi.fn();
    let selectCutoff;
    const db = {
      prepare(sql) {
        return {
          bind(...b) { if (sql.includes("SELECT")) selectCutoff = b[0]; return this; },
          async all() { return { results: [] }; },
          async run() { return {}; },
        };
      },
    };
    await archiveOldEvents({ DB: db, EVENTS_ARCHIVE: { put } }, NOW);
    expect(selectCutoff).toBe(new Date(NOW - RETENTION_DAYS * 86400000).toISOString());
  });

  it("skips cleanly when no R2 bucket is bound", async () => {
    const db = makeDb([[]]);
    const result = await archiveOldEvents({ DB: db }, NOW);
    expect(result).toEqual({ archived: 0, skipped: true });
  });
});
