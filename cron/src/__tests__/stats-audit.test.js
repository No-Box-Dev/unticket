import { describe, expect, it } from "vitest";
import { statsAuditInternals } from "../stats-audit.js";

describe("stats audit month handling", () => {
  it("enumerates inclusive month ranges across years", () => {
    expect(statsAuditInternals.enumerateMonths("2025-11", "2026-02")).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });

  it("uses the correct final day, including leap years", () => {
    expect(statsAuditInternals.monthRange("2024-02")).toEqual({
      start: "2024-02-01",
      end: "2024-02-29",
    });
    expect(statsAuditInternals.monthRange("2026-07")).toEqual({
      start: "2026-07-01",
      end: "2026-07-31",
    });
  });

  it("rejects invalid or reversed ranges", () => {
    expect(() => statsAuditInternals.enumerateMonths("2026-13", "2026-14")).toThrow();
    expect(() => statsAuditInternals.enumerateMonths("2026-08", "2026-07")).toThrow();
  });
});
