import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}));

import { apiGet, apiPost, apiDelete } from "../api";
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
const mockDelete = vi.mocked(apiDelete);

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockDelete.mockReset();
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
    mockDelete.mockResolvedValue({ ok: true });
    await unlinkPR(5, "api", 100);
    expect(mockDelete).toHaveBeenCalledWith(
      "/api/pr-links?feature=5&pr_repo=api&pr_number=100",
    );
  });

  it("encodes special characters in the repo name", async () => {
    mockDelete.mockResolvedValue({ ok: true });
    await unlinkPR(5, "a/b c", 1);
    const [url] = mockDelete.mock.calls[0];
    expect(url).toContain("pr_repo=a%2Fb%20c");
  });

  it("propagates the error when the API helper rejects", async () => {
    mockDelete.mockRejectedValue(new Error("PR not linked"));
    await expect(unlinkPR(5, "api", 1)).rejects.toThrow("PR not linked");
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
