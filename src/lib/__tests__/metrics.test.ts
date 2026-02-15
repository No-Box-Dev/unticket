import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  computeMetric,
  computeCumulativeMetric,
  extractMergedDates,
  extractClosedDates,
  extractCreatedDates,
  buildOpenIssueSnapshots,
} from "../metrics";

// Pin "now" to a known date so weekly buckets are deterministic
const NOW = new Date("2026-02-15T12:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

// ── extractMergedDates ───────────────────────────────────────────────
describe("extractMergedDates", () => {
  it("returns merged_at values", () => {
    const prs = [
      { merged_at: "2026-02-10T10:00:00Z" },
      { merged_at: "2026-02-12T10:00:00Z" },
    ];
    expect(extractMergedDates(prs)).toEqual([
      "2026-02-10T10:00:00Z",
      "2026-02-12T10:00:00Z",
    ]);
  });

  it("filters out null/undefined merged_at", () => {
    const prs = [
      { merged_at: "2026-02-10T10:00:00Z" },
      { merged_at: null },
      { merged_at: undefined },
    ];
    expect(extractMergedDates(prs)).toEqual(["2026-02-10T10:00:00Z"]);
  });

  it("returns empty array for empty input", () => {
    expect(extractMergedDates([])).toEqual([]);
  });
});

// ── extractClosedDates ───────────────────────────────────────────────
describe("extractClosedDates", () => {
  it("returns closed_at values", () => {
    const issues = [{ closed_at: "2026-02-01T00:00:00Z" }];
    expect(extractClosedDates(issues)).toEqual(["2026-02-01T00:00:00Z"]);
  });

  it("filters out null/undefined closed_at", () => {
    const issues = [
      { closed_at: "2026-02-01T00:00:00Z" },
      { closed_at: null },
      {},
    ];
    expect(extractClosedDates(issues as any)).toEqual(["2026-02-01T00:00:00Z"]);
  });

  it("returns empty for empty input", () => {
    expect(extractClosedDates([])).toEqual([]);
  });
});

// ── extractCreatedDates ──────────────────────────────────────────────
describe("extractCreatedDates", () => {
  it("returns created_at values", () => {
    const items = [
      { created_at: "2026-02-01T00:00:00Z" },
      { created_at: "2026-02-05T00:00:00Z" },
    ];
    expect(extractCreatedDates(items)).toEqual([
      "2026-02-01T00:00:00Z",
      "2026-02-05T00:00:00Z",
    ]);
  });

  it("returns empty for empty input", () => {
    expect(extractCreatedDates([])).toEqual([]);
  });
});

// ── computeMetric ────────────────────────────────────────────────────
describe("computeMetric", () => {
  it("returns zeros for empty input", () => {
    const result = computeMetric([], 4);
    expect(result.current).toBe(0);
    expect(result.previous).toBe(0);
    expect(result.change).toBe(0);
    expect(result.history).toHaveLength(4);
    result.history.forEach((b) => expect(b.value).toBe(0));
  });

  it("buckets dates into weekly bins", () => {
    // Two dates in the current week (week starting Sunday 2026-02-15)
    const dates = [
      "2026-02-15T10:00:00Z",
      "2026-02-16T10:00:00Z",
    ];
    const result = computeMetric(dates, 3);
    expect(result.history).toHaveLength(3);
    // Current week should have 2
    expect(result.current).toBe(2);
  });

  it("computes change between current and previous week", () => {
    const dates = [
      // Previous week (Feb 8-14)
      "2026-02-09T10:00:00Z",
      "2026-02-10T10:00:00Z",
      "2026-02-11T10:00:00Z",
      // Current week (Feb 15+)
      "2026-02-15T10:00:00Z",
    ];
    const result = computeMetric(dates, 3);
    expect(result.current).toBe(1);
    expect(result.previous).toBe(3);
    expect(result.change).toBe(-2);
  });

  it("history is sorted chronologically", () => {
    const result = computeMetric([], 5);
    for (let i = 1; i < result.history.length; i++) {
      expect(result.history[i].weekStart >= result.history[i - 1].weekStart).toBe(true);
    }
  });

  it("ignores dates outside the window", () => {
    const dates = ["2020-01-01T00:00:00Z"];
    const result = computeMetric(dates, 3);
    result.history.forEach((b) => expect(b.value).toBe(0));
  });
});

// ── computeCumulativeMetric ──────────────────────────────────────────
describe("computeCumulativeMetric", () => {
  it("returns zeros for empty input", () => {
    const result = computeCumulativeMetric([]);
    expect(result.current).toBe(0);
    expect(result.previous).toBe(0);
    expect(result.change).toBe(0);
    expect(result.history).toEqual([]);
  });

  it("returns current and previous from sorted snapshots", () => {
    const snapshots = [
      { weekStart: "2026-02-01", value: 10 },
      { weekStart: "2026-02-08", value: 8 },
      { weekStart: "2026-02-15", value: 5 },
    ];
    const result = computeCumulativeMetric(snapshots);
    expect(result.current).toBe(5);
    expect(result.previous).toBe(8);
    expect(result.change).toBe(-3);
  });

  it("sorts unsorted input", () => {
    const snapshots = [
      { weekStart: "2026-02-15", value: 5 },
      { weekStart: "2026-02-01", value: 10 },
    ];
    const result = computeCumulativeMetric(snapshots);
    expect(result.current).toBe(5);
    expect(result.previous).toBe(10);
    expect(result.history[0].weekStart).toBe("2026-02-01");
  });

  it("handles single snapshot", () => {
    const result = computeCumulativeMetric([{ weekStart: "2026-02-15", value: 3 }]);
    expect(result.current).toBe(3);
    expect(result.previous).toBe(0);
    expect(result.change).toBe(3);
  });
});

// ── buildOpenIssueSnapshots ──────────────────────────────────────────
describe("buildOpenIssueSnapshots", () => {
  it("returns correct number of weekly buckets", () => {
    const result = buildOpenIssueSnapshots([], 4);
    expect(result).toHaveLength(4);
  });

  it("counts issues open at each week end", () => {
    const issues = [
      // Created early, still open
      { created_at: "2026-01-01T00:00:00Z", closed_at: null, state: "open" },
      // Created early, closed mid-period
      { created_at: "2026-01-01T00:00:00Z", closed_at: "2026-02-05T00:00:00Z", state: "closed" },
    ];
    const result = buildOpenIssueSnapshots(issues, 4);
    // Last bucket (current week) should have 1 (first issue still open, second is closed)
    const last = result[result.length - 1];
    expect(last.value).toBe(1);
  });

  it("issue created after week end is not counted for that week", () => {
    const issues = [
      { created_at: "2026-02-20T00:00:00Z", closed_at: null, state: "open" },
    ];
    const result = buildOpenIssueSnapshots(issues, 4);
    // All buckets should be 0 since issue is created in the future
    result.forEach((b) => expect(b.value).toBe(0));
  });

  it("issue closed before week end is not counted as open", () => {
    const issues = [
      { created_at: "2026-01-01T00:00:00Z", closed_at: "2026-01-15T00:00:00Z", state: "closed" },
    ];
    const result = buildOpenIssueSnapshots(issues, 4);
    // All recent weeks should show 0 since issue was closed long ago
    result.forEach((b) => expect(b.value).toBe(0));
  });

  it("returns sorted by weekStart", () => {
    const result = buildOpenIssueSnapshots([], 5);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].weekStart >= result[i - 1].weekStart).toBe(true);
    }
  });
});
