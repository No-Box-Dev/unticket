import { describe, it, expect } from "vitest";
import { toIsoSince } from "../github-sync";

describe("toIsoSince", () => {
  it("converts SQLite datetime('now') format to ISO 8601 with trailing Z", () => {
    expect(toIsoSince("2026-05-11 07:47:51")).toBe("2026-05-11T07:47:51Z");
  });

  it("passes through values already in ISO 8601 form", () => {
    expect(toIsoSince("2026-05-11T07:47:51Z")).toBe("2026-05-11T07:47:51Z");
  });

  it("returns null/undefined unchanged so callers can pass cursors through", () => {
    expect(toIsoSince(null)).toBe(null);
    expect(toIsoSince(undefined)).toBe(undefined);
    expect(toIsoSince("")).toBe("");
  });
});
