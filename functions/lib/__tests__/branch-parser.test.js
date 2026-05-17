import { describe, it, expect } from "vitest";
import { parseFeatureFromBranch } from "../branch-parser.js";

describe("parseFeatureFromBranch", () => {
  it("returns null for falsy inputs", () => {
    expect(parseFeatureFromBranch("")).toBeNull();
    expect(parseFeatureFromBranch(null)).toBeNull();
    expect(parseFeatureFromBranch(undefined)).toBeNull();
  });

  it.each([
    ["feat/42-add-thing", 42],
    ["feature/7-something", 7],
    ["fix/100-bug-fix", 100],
    ["chore/12-cleanup", 12],
    ["refactor/55-rename", 55],
  ])("parses prefixed branch %s → %i", (ref, expected) => {
    expect(parseFeatureFromBranch(ref)).toBe(expected);
  });

  it("parses prefixed branch with no trailing slug", () => {
    expect(parseFeatureFromBranch("feat/42")).toBe(42);
  });

  it("parses plain leading-number branches", () => {
    expect(parseFeatureFromBranch("42-some-work")).toBe(42);
    expect(parseFeatureFromBranch("9-x")).toBe(9);
  });

  it("returns null for unknown prefixes", () => {
    expect(parseFeatureFromBranch("docs/12-readme")).toBeNull();
    expect(parseFeatureFromBranch("hotfix/3-thing")).toBeNull();
  });

  it("returns null when number isn't separated by '-' (plain form)", () => {
    expect(parseFeatureFromBranch("42abc")).toBeNull();
    expect(parseFeatureFromBranch("42")).toBeNull();
  });

  it("requires '-' or end after the number in prefixed form", () => {
    // Slash with non-dash continuation should fail the PREFIXED regex
    expect(parseFeatureFromBranch("feat/42abc")).toBeNull();
  });

  it("returns null for branches without any number marker", () => {
    expect(parseFeatureFromBranch("main")).toBeNull();
    expect(parseFeatureFromBranch("feat/add-thing")).toBeNull();
  });
});
