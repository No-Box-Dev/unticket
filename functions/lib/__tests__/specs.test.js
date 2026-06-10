import { describe, it, expect } from "vitest";
import { joinPath, isSafeSegment, hasUnsafePathSegment } from "../specs.js";

describe("joinPath", () => {
  it("joins clean segments", () => {
    expect(joinPath("specs", "auth")).toBe("specs/auth");
    expect(joinPath("specs", "auth", "design.md")).toBe("specs/auth/design.md");
  });
  it("strips leading + trailing slashes", () => {
    expect(joinPath("/specs/", "/auth/", "/design.md/")).toBe("specs/auth/design.md");
  });
  it("drops empty segments", () => {
    expect(joinPath("", "specs", "", "auth")).toBe("specs/auth");
  });
  it("tolerates null/undefined", () => {
    expect(joinPath(null, "specs", undefined)).toBe("specs");
  });
  it("collapses to '' when nothing valid", () => {
    expect(joinPath("", null, undefined)).toBe("");
  });
});

describe("isSafeSegment", () => {
  it("accepts a simple name", () => {
    expect(isSafeSegment("auth")).toBe(true);
    expect(isSafeSegment("auth-v2")).toBe(true);
    expect(isSafeSegment("auth.spec")).toBe(true);
  });
  it("accepts names with consecutive dots (only literal `..` fails)", () => {
    expect(isSafeSegment("auth..v2")).toBe(true);
    expect(isSafeSegment("design..notes")).toBe(true);
  });
  it("rejects empty / non-string", () => {
    expect(isSafeSegment("")).toBe(false);
    expect(isSafeSegment(null)).toBe(false);
    expect(isSafeSegment(123)).toBe(false);
  });
  it("rejects the literal traversal segment", () => {
    expect(isSafeSegment("..")).toBe(false);
    expect(isSafeSegment(".")).toBe(false);
  });
  it("rejects segments containing a slash (no smuggling multi-segment paths)", () => {
    expect(isSafeSegment("a/b")).toBe(false);
    expect(isSafeSegment("/auth")).toBe(false);
    expect(isSafeSegment("auth/")).toBe(false);
  });
  it("rejects backslashes", () => {
    expect(isSafeSegment("a\\b")).toBe(false);
  });
});

describe("hasUnsafePathSegment", () => {
  it("returns false for an empty path", () => {
    expect(hasUnsafePathSegment("")).toBe(false);
  });
  it("returns false for clean slash-separated paths", () => {
    expect(hasUnsafePathSegment("docs/auth")).toBe(false);
    expect(hasUnsafePathSegment("docs/auth/design.md")).toBe(false);
  });
  it("returns false for paths with `..` mid-segment (legitimate filenames)", () => {
    expect(hasUnsafePathSegment("docs/design..v2.md")).toBe(false);
    expect(hasUnsafePathSegment("docs/foo..bar")).toBe(false);
  });
  it("returns true for `..` as a full segment", () => {
    expect(hasUnsafePathSegment("docs/../etc")).toBe(true);
    expect(hasUnsafePathSegment("..")).toBe(true);
    expect(hasUnsafePathSegment("../docs")).toBe(true);
  });
  it("returns true for empty segments (double-slash)", () => {
    expect(hasUnsafePathSegment("docs//auth")).toBe(true);
  });
  it("returns true for backslashes", () => {
    expect(hasUnsafePathSegment("docs\\auth")).toBe(true);
  });
  it("returns true for non-strings", () => {
    expect(hasUnsafePathSegment(null)).toBe(true);
    expect(hasUnsafePathSegment(undefined)).toBe(true);
  });
});
