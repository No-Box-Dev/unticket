import { describe, it, expect, beforeEach } from "vitest";
import { getUnticketRepoName, setUnticketRepoName } from "../unticket-repo-name";

// The module holds a process-lifetime cache; reset it before each test.
beforeEach(() => setUnticketRepoName(null));

describe("getUnticketRepoName / setUnticketRepoName", () => {
  it("returns the legacy default when nothing is set", () => {
    expect(getUnticketRepoName()).toBe("unticket");
  });

  it("returns the configured value after set", () => {
    setUnticketRepoName("config");
    expect(getUnticketRepoName()).toBe("config");
  });

  it("trims surrounding whitespace", () => {
    setUnticketRepoName("  cfg-repo  ");
    expect(getUnticketRepoName()).toBe("cfg-repo");
  });

  it("falls back to default when set to blank/whitespace/empty", () => {
    setUnticketRepoName("cfg");
    expect(getUnticketRepoName()).toBe("cfg");
    setUnticketRepoName("   ");
    expect(getUnticketRepoName()).toBe("unticket");
    setUnticketRepoName("");
    expect(getUnticketRepoName()).toBe("unticket");
  });

  it("falls back to default when explicitly nulled", () => {
    setUnticketRepoName("cfg");
    setUnticketRepoName(null);
    expect(getUnticketRepoName()).toBe("unticket");
    setUnticketRepoName("cfg");
    setUnticketRepoName(undefined);
    expect(getUnticketRepoName()).toBe("unticket");
  });

  it("ignores non-string values (still falls back)", () => {
    // @ts-expect-error — intentionally passing wrong type
    setUnticketRepoName(42);
    expect(getUnticketRepoName()).toBe("unticket");
  });
});
