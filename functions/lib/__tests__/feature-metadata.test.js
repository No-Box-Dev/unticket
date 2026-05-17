import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseFeatureMetadata,
  serializeFeatureMetadata,
  parseFeaturesFromBody,
  readFeatureIssue,
  updateFeatureBody,
} from "../feature-metadata.js";

describe("parseFeatureMetadata", () => {
  it("returns empty content + metadata for falsy body", () => {
    expect(parseFeatureMetadata("")).toEqual({ content: "", metadata: {} });
    expect(parseFeatureMetadata(null)).toEqual({ content: "", metadata: {} });
    expect(parseFeatureMetadata(undefined)).toEqual({ content: "", metadata: {} });
  });

  it("returns body unchanged when no metadata block present", () => {
    const body = "Just plain markdown text\n\nAnother paragraph";
    expect(parseFeatureMetadata(body)).toEqual({ content: body, metadata: {} });
  });

  it("extracts metadata block and strips it from content", () => {
    // The regex only consumes one of the two leading newlines before `<!--`,
    // so the content keeps one trailing newline. That's the contract — every
    // caller either re-serializes (which re-adds the spacing) or renders as
    // markdown (which collapses it).
    const body =
      "Plan goes here\n\n<!-- unticket:metadata\n" +
      JSON.stringify({ linkedPRs: [{ repo: "api", number: 7 }] }) +
      "\n-->";
    const { content, metadata } = parseFeatureMetadata(body);
    expect(content).toBe("Plan goes here\n");
    expect(metadata).toEqual({ linkedPRs: [{ repo: "api", number: 7 }] });
  });

  it("treats a corrupt metadata block as no metadata (warns, keeps body)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const body = "Plan\n\n<!-- unticket:metadata\n{not valid json\n-->";
    const { content, metadata } = parseFeatureMetadata(body);
    expect(metadata).toEqual({});
    expect(content).toBe(body);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("tolerates trailing whitespace after the metadata block", () => {
    const body =
      "X\n\n<!-- unticket:metadata\n" +
      JSON.stringify({ statusHistory: [{ status: "todo", at: "2025-01-01" }] }) +
      "\n-->   \n  ";
    const { content, metadata } = parseFeatureMetadata(body);
    expect(content).toBe("X\n");
    expect(metadata.statusHistory).toHaveLength(1);
  });
});

describe("serializeFeatureMetadata", () => {
  it("returns content unchanged when metadata has nothing worth persisting", () => {
    expect(serializeFeatureMetadata("hello", {})).toBe("hello");
    expect(serializeFeatureMetadata("hello", { linkedPRs: [], statusHistory: [] })).toBe("hello");
  });

  it("appends a metadata block when linkedPRs is non-empty", () => {
    const out = serializeFeatureMetadata("plan", {
      linkedPRs: [{ repo: "api", number: 5 }],
    });
    expect(out).toContain("plan\n\n<!-- unticket:metadata\n");
    expect(out).toMatch(/-->$/);
    expect(out).toContain('"linkedPRs":[{"repo":"api","number":5}]');
  });

  it("appends a metadata block when statusHistory is non-empty", () => {
    const out = serializeFeatureMetadata("plan", {
      statusHistory: [{ status: "production", at: "2026-05-01" }],
    });
    expect(out).toContain('"statusHistory"');
  });

  it("roundtrips parse → serialize → parse (metadata preserved exactly)", () => {
    const original = {
      linkedPRs: [{ repo: "api", number: 1 }, { repo: "web", number: 42 }],
      statusHistory: [{ status: "staging", at: "2026-05-10T12:00:00Z" }],
    };
    const body = serializeFeatureMetadata("Plan content", original);
    const { content, metadata } = parseFeatureMetadata(body);
    // serialize adds "\n\n" before the block, parse only consumes one — that
    // single trailing newline is stable across further roundtrips.
    expect(content.trimEnd()).toBe("Plan content");
    expect(metadata).toEqual(original);
  });
});

describe("parseFeaturesFromBody", () => {
  it("returns [] for empty body", () => {
    expect(parseFeaturesFromBody("")).toEqual([]);
    expect(parseFeaturesFromBody(null)).toEqual([]);
    expect(parseFeaturesFromBody(undefined)).toEqual([]);
  });

  it("matches 'Part of org/unticket#N' and 'Part of unticket#N'", () => {
    expect(parseFeaturesFromBody("Part of acme/unticket#12")).toEqual([12]);
    expect(parseFeaturesFromBody("Part of unticket#7")).toEqual([7]);
  });

  it("matches 'Feature #N' and 'Feature: #N'", () => {
    expect(parseFeaturesFromBody("Feature #99")).toEqual([99]);
    expect(parseFeaturesFromBody("Feature: #100")).toEqual([100]);
  });

  it("matches standalone unticket#N references", () => {
    expect(parseFeaturesFromBody("See unticket#42 for details")).toEqual([42]);
  });

  it("matches closing keywords (fixes/closes/resolves)", () => {
    expect(parseFeaturesFromBody("Fixes unticket#5")).toEqual([5]);
    expect(parseFeaturesFromBody("Closes acme/unticket#6")).toEqual([6]);
    expect(parseFeaturesFromBody("resolves unticket#7")).toEqual([7]);
  });

  it("is case-insensitive", () => {
    expect(parseFeaturesFromBody("FIXES UNTICKET#3")).toEqual([3]);
  });

  it("dedupes overlapping matches across rules", () => {
    const body = "Part of unticket#10. Also fixes acme/unticket#10. See unticket#10.";
    expect(parseFeaturesFromBody(body).sort()).toEqual([10]);
  });

  it("collects multiple distinct feature numbers", () => {
    const body = "Part of unticket#1 and fixes unticket#2 and Feature #3";
    expect(parseFeaturesFromBody(body).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it("ignores unrelated # references like other-repo#42", () => {
    expect(parseFeaturesFromBody("See api-backend#42 for context")).toEqual([]);
  });
});

describe("readFeatureIssue / updateFeatureBody", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("readFeatureIssue calls the right URL with bearer auth", async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ number: 42, body: "x" }) });
    const issue = await readFeatureIssue("tok", "acme", 42);
    expect(issue.number).toBe(42);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/acme/unticket/issues/42",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer tok" }),
      }),
    );
  });

  it("readFeatureIssue throws on non-OK response", async () => {
    fetch.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    await expect(readFeatureIssue("tok", "acme", 7)).rejects.toThrow(/#7: 404/);
  });

  it("updateFeatureBody PATCHes with JSON body", async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    await updateFeatureBody("tok", "acme", 5, "new body");
    const [, init] = fetch.mock.calls[0];
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ body: "new body" });
  });
});
