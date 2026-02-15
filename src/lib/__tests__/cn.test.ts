import { describe, it, expect } from "vitest";
import { cn } from "../cn";

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("px-2", "py-1")).toBe("px-2 py-1");
  });

  it("handles conditional classes", () => {
    expect(cn("base", false && "hidden", "extra")).toBe("base extra");
  });

  it("merges conflicting tailwind classes (last wins)", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("handles undefined and null values", () => {
    expect(cn("a", undefined, null, "b")).toBe("a b");
  });

  it("handles empty string", () => {
    expect(cn("", "a")).toBe("a");
  });

  it("returns empty string for no args", () => {
    expect(cn()).toBe("");
  });
});
