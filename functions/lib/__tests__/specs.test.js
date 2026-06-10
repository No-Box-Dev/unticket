import { describe, it, expect } from "vitest";
import { joinPath, isSafeSegment } from "../specs.js";

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
  it("rejects empty / non-string", () => {
    expect(isSafeSegment("")).toBe(false);
    expect(isSafeSegment(null)).toBe(false);
    expect(isSafeSegment(123)).toBe(false);
  });
  it("rejects path-traversal", () => {
    expect(isSafeSegment("..")).toBe(false);
    expect(isSafeSegment("a/..")).toBe(false);
    expect(isSafeSegment("a..b")).toBe(false);
  });
  it("rejects backslashes", () => {
    expect(isSafeSegment("a\\b")).toBe(false);
  });
  it("rejects leading / trailing slashes", () => {
    expect(isSafeSegment("/auth")).toBe(false);
    expect(isSafeSegment("auth/")).toBe(false);
  });
});
