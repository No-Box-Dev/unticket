import { describe, it, expect } from "vitest";
import { CHART_PALETTE, SEVERITY } from "../chart-palette";

describe("CHART_PALETTE", () => {
  it("exposes the five-color palette", () => {
    expect(CHART_PALETTE).toHaveLength(5);
  });

  it("only contains hex color strings", () => {
    for (const c of CHART_PALETTE) {
      expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe("SEVERITY", () => {
  it("has low/mid/high keys", () => {
    expect(Object.keys(SEVERITY).sort()).toEqual(["high", "low", "mid"]);
  });

  it("each severity color is a hex string", () => {
    for (const v of Object.values(SEVERITY)) {
      expect(v).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
