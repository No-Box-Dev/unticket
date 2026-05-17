import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiFetch: vi.fn(),
}));

import { apiGet, apiPost, apiFetch } from "../api";
import {
  fetchLinkedPRs,
  fetchLinkedFeatures,
  linkPR,
  unlinkPR,
  backfillFeatureMatches,
  unlinkAllPRs,
} from "../pr-links";

const mockGet = vi.mocked(apiGet);
const mockPost = vi.mocked(apiPost);
const mockFetch = vi.mocked(apiFetch);

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockFetch.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("fetchLinkedPRs", () => {
  it("queries the right URL", async () => {
    mockGet.mockResolvedValue([]);
    await fetchLinkedPRs(42);
    expect(mockGet).toHaveBeenCalledWith("/api/pr-links?feature=42");
  });
});

describe("fetchLinkedFeatures", () => {
  it("encodes the repo segment", async () => {
    mockGet.mockResolvedValue([]);
    await fetchLinkedFeatures("api/backend", 7);
    expect(mockGet).toHaveBeenCalledWith("/api/pr-links?pr_repo=api%2Fbackend&pr_number=7");
  });
});

describe("linkPR", () => {
  it("POSTs the link triple", async () => {
    mockPost.mockResolvedValue({ ok: true });
    await linkPR(5, "api", 100);
    expect(mockPost).toHaveBeenCalledWith("/api/pr-links", {
      feature_number: 5,
      pr_repo: "api",
      pr_number: 100,
    });
  });
});

describe("unlinkPR", () => {
  it("DELETEs the matching URL", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ ok: true }),
    } as Response);
    await unlinkPR(5, "api", 100);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/pr-links?feature=5&pr_repo=api&pr_number=100",
      { method: "DELETE" },
    );
  });

  it("encodes special characters in the repo name", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    } as Response);
    await unlinkPR(5, "a/b c", 1);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("pr_repo=a%2Fb%20c");
  });

  it("throws with the server error message on non-ok", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({ error: "PR not linked" }),
    } as Response);
    await expect(unlinkPR(5, "api", 1)).rejects.toThrow("PR not linked");
  });

  it("falls back to statusText when the server returns no JSON body", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Server Error",
      json: async () => { throw new Error("not json"); },
    } as unknown as Response);
    await expect(unlinkPR(5, "api", 1)).rejects.toThrow("Server Error");
  });
});

describe("backfillFeatureMatches", () => {
  it("POSTs days + force to the backfill endpoint", async () => {
    mockPost.mockResolvedValue({ ok: true, scanned: 0, queued: 0, days: 14, force: false });
    await backfillFeatureMatches(14, false);
    expect(mockPost).toHaveBeenCalledWith("/api/features/backfill-matches", {
      days: 14,
      force: false,
    });
  });
});

describe("unlinkAllPRs", () => {
  it("POSTs the confirmation token to the unlink-all endpoint", async () => {
    mockPost.mockResolvedValue({
      ok: true,
      featuresAffected: 0,
      featuresCleared: 0,
      linksDeleted: 0,
      attemptsCleared: 0,
      errors: [],
    });
    await unlinkAllPRs();
    expect(mockPost).toHaveBeenCalledWith("/api/pr-links/unlink-all", {
      confirm: "UNLINK_ALL",
    });
  });
});
