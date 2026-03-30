/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  computeMetric,
  computeMetricDaily,
  computeCumulativeMetric,
  extractMergedDates,
  extractClosedDates,
  extractCreatedDates,
  extractReviewedDates,
  computeBurndown,
  computeEngineerStatus,
  computeCycleTime,
  computeReviewLoad,
  computeContributorActivity,
  computeAlerts,
  computeVelocityTrend,
  buildOpenIssueSnapshots,
} from "../metrics";
import type { Feature, SprintConfig } from "../types";

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

// ── extractReviewedDates ──────────────────────────────────────────────
describe("extractReviewedDates", () => {
  it("generates one date per reviewer per merged PR", () => {
    const prs = [
      { merged_at: "2026-02-10T10:00:00Z", requested_reviewers: [{ login: "a" }, { login: "b" }] },
      { merged_at: null, requested_reviewers: [{ login: "c" }] },
      { merged_at: "2026-02-11T10:00:00Z", requested_reviewers: [] },
    ];
    const dates = extractReviewedDates(prs);
    expect(dates).toHaveLength(2);
    expect(dates).toEqual(["2026-02-10T10:00:00Z", "2026-02-10T10:00:00Z"]);
  });

  it("returns empty for no merged PRs", () => {
    expect(extractReviewedDates([])).toEqual([]);
  });
});

// ── computeMetricDaily ─────────────────────────────────────────────
describe("computeMetricDaily", () => {
  it("returns zeros for empty input", () => {
    const result = computeMetricDaily([], 7);
    expect(result.current).toBe(0);
    expect(result.previous).toBe(0);
    expect(result.history).toHaveLength(7);
  });

  it("counts dates into daily buckets", () => {
    const dates = [
      "2026-02-15T10:00:00Z", // today
      "2026-02-15T08:00:00Z", // today
      "2026-02-14T10:00:00Z", // yesterday
    ];
    const result = computeMetricDaily(dates, 3);
    expect(result.current).toBe(2);
    expect(result.previous).toBe(1);
    expect(result.change).toBe(1);
  });
});

// ── computeBurndown ────────────────────────────────────────────────
describe("computeBurndown", () => {
  const sprint: SprintConfig = {
    number: 1,
    name: "Sprint 1",
    startDate: "2026-02-09",
    endDate: "2026-02-23",
    focus: "test",
  };

  it("ideal line goes from total to 0", () => {
    const features: Feature[] = [
      { id: 1, title: "F1", owners: [], status: "in_progress", sprint: 1 },
      { id: 2, title: "F2", owners: [], status: "plan", sprint: 1 },
      { id: 3, title: "F3", owners: [], status: "production", sprint: 1, statusHistory: [{ status: "production", timestamp: "2026-02-12T10:00:00Z" }] },
    ];
    const { ideal } = computeBurndown(features, sprint);
    expect(ideal[0].y).toBe(3);
    expect(ideal[ideal.length - 1].y).toBe(0);
  });

  it("actual tracks remaining features per day", () => {
    const features: Feature[] = [
      { id: 1, title: "F1", owners: [], status: "production", sprint: 1, statusHistory: [{ status: "production", timestamp: "2026-02-12T10:00:00Z" }] },
      { id: 2, title: "F2", owners: [], status: "in_progress", sprint: 1 },
    ];
    const { actual } = computeBurndown(features, sprint);
    // Day 0 (Feb 9): both remaining (prod timestamp is Feb 12 > Feb 9)
    expect(actual[0].y).toBe(2);
    // By day 6 (Feb 15, past now): F1 is done, F2 still remaining
    const day6 = actual.find((a) => a.x === 6);
    expect(day6?.y).toBe(1);
  });

  it("production features without history count as remaining", () => {
    const features: Feature[] = [
      { id: 1, title: "F1", owners: [], status: "production", sprint: 1 },
    ];
    const { actual } = computeBurndown(features, sprint);
    expect(actual[0].y).toBe(1);
  });

  it("handles empty features", () => {
    const { ideal, actual } = computeBurndown([], sprint);
    expect(ideal[0].y).toBe(0);
    expect(actual[0].y).toBe(0);
  });
});

// ── computeEngineerStatus ──────────────────────────────────────────
describe("computeEngineerStatus", () => {
  const sprint: SprintConfig = {
    number: 1,
    name: "Sprint 1",
    startDate: "2026-02-09",
    endDate: "2026-02-23",
    focus: "test",
  };

  it("on-track for no features", () => {
    expect(computeEngineerStatus([], sprint)).toBe("on-track");
  });

  it("on-track when all done", () => {
    const features: Feature[] = [
      { id: 1, title: "F1", owners: [], status: "production", sprint: 1 },
    ];
    expect(computeEngineerStatus(features, sprint)).toBe("on-track");
  });

  it("behind when nothing done mid-sprint", () => {
    // Sprint is ~43% elapsed (Feb 15 out of Feb 9-23), 0% done
    const features: Feature[] = [
      { id: 1, title: "F1", owners: [], status: "plan", sprint: 1 },
      { id: 2, title: "F2", owners: [], status: "plan", sprint: 1 },
      { id: 3, title: "F3", owners: [], status: "plan", sprint: 1 },
    ];
    expect(computeEngineerStatus(features, sprint)).toBe("behind");
  });
});

// ── computeCycleTime ───────────────────────────────────────────────
describe("computeCycleTime", () => {
  it("returns 0 for empty PRs", () => {
    const result = computeCycleTime([], 4);
    expect(result.median).toBe(0);
    expect(result.history).toHaveLength(4);
  });

  it("computes median cycle time in hours", () => {
    const prs = [
      { created_at: "2026-02-13T00:00:00Z", merged_at: "2026-02-14T00:00:00Z" }, // 24h
      { created_at: "2026-02-13T00:00:00Z", merged_at: "2026-02-15T00:00:00Z" }, // 48h
      { created_at: "2026-02-13T00:00:00Z", merged_at: null }, // not merged
    ];
    const result = computeCycleTime(prs, 4);
    expect(result.median).toBe(36); // median of [24, 48]
  });

  it("buckets cycle times into weekly bins", () => {
    const prs = [
      { created_at: "2026-02-14T00:00:00Z", merged_at: "2026-02-15T00:00:00Z" }, // 24h, current week
    ];
    const result = computeCycleTime(prs, 4);
    const currentWeek = result.history[result.history.length - 1];
    expect(currentWeek.value).toBe(24);
  });
});

// ── computeReviewLoad ──────────────────────────────────────────────
describe("computeReviewLoad", () => {
  it("returns empty for no PRs", () => {
    expect(computeReviewLoad([])).toEqual([]);
  });

  it("counts review requests per person, sorted desc", () => {
    const prs = [
      { requested_reviewers: [{ login: "alice" }, { login: "bob" }] },
      { requested_reviewers: [{ login: "alice" }] },
    ];
    const result = computeReviewLoad(prs);
    expect(result[0]).toEqual({ login: "alice", count: 2 });
    expect(result[1]).toEqual({ login: "bob", count: 1 });
  });
});

// ── computeContributorActivity ─────────────────────────────────────
describe("computeContributorActivity", () => {
  it("aggregates per-person stats within date range", () => {
    const mergedPRs = [
      { user: { login: "alice" }, merged_at: "2026-02-10T10:00:00Z", requested_reviewers: [{ login: "bob" }] },
      { user: { login: "bob" }, merged_at: "2026-02-11T10:00:00Z", requested_reviewers: [] },
      { user: { login: "alice" }, merged_at: "2026-01-01T10:00:00Z", requested_reviewers: [] }, // out of range
    ];
    const closedIssues = [
      { closed_by: "alice", closed_at: "2026-02-10T10:00:00Z" },
    ];
    const tasks = [
      { assignees: ["alice"], state: "closed", points: 5 },
      { assignees: ["bob"], state: "open", points: 3 },
    ];

    const result = computeContributorActivity(mergedPRs, closedIssues, tasks, "2026-02-09", "2026-02-23");

    const alice = result.find((r) => r.login === "alice")!;
    expect(alice.prsMerged).toBe(1);
    expect(alice.issuesClosed).toBe(1);
    expect(alice.pointsDone).toBe(5);

    const bob = result.find((r) => r.login === "bob")!;
    expect(bob.prsMerged).toBe(1);
    expect(bob.prsReviewed).toBe(1);
    expect(bob.pointsDone).toBe(0);
  });

  it("splits points across multiple assignees", () => {
    const tasks = [
      { assignees: ["alice", "bob"], state: "closed", points: 10 },
    ];
    const result = computeContributorActivity([], [], tasks, "2026-02-09", "2026-02-23");
    const alice = result.find((r) => r.login === "alice")!;
    const bob = result.find((r) => r.login === "bob")!;
    expect(alice.pointsDone).toBe(5);
    expect(bob.pointsDone).toBe(5);
  });

  it("returns empty for no data", () => {
    expect(computeContributorActivity([], [], [], "2026-02-09", "2026-02-23")).toEqual([]);
  });
});

// ── computeAlerts ──────────────────────────────────────────────────
describe("computeAlerts", () => {
  it("returns empty for healthy state", () => {
    expect(computeAlerts([], [], null, 5)).toEqual([]);
  });

  it("detects stale PRs (>7 days)", () => {
    const stalePR = {
      created_at: "2026-02-01T10:00:00Z", // >7 days ago
      requested_reviewers: [{ login: "a" }],
      draft: false,
    };
    const alerts = computeAlerts([stalePR], [], null, 5);
    expect(alerts.some((a) => a.icon === "stale")).toBe(true);
  });

  it("ignores draft PRs for stale/unreviewed", () => {
    const draftPR = {
      created_at: "2026-02-01T10:00:00Z",
      requested_reviewers: [],
      draft: true,
    };
    const alerts = computeAlerts([draftPR], [], null, 5);
    expect(alerts).toEqual([]);
  });

  it("detects unreviewed PRs", () => {
    const unreviewedPR = {
      created_at: "2026-02-14T10:00:00Z",
      requested_reviewers: [],
      draft: false,
    };
    const alerts = computeAlerts([unreviewedPR], [], null, 5);
    expect(alerts.some((a) => a.icon === "unreviewed")).toBe(true);
  });

  it("detects review bottleneck (>40% of reviews)", () => {
    const prs = [
      { created_at: "2026-02-14T10:00:00Z", requested_reviewers: [{ login: "alice" }], draft: false },
      { created_at: "2026-02-14T10:00:00Z", requested_reviewers: [{ login: "alice" }], draft: false },
      { created_at: "2026-02-14T10:00:00Z", requested_reviewers: [{ login: "bob" }], draft: false },
    ];
    const alerts = computeAlerts(prs, [], null, 5);
    expect(alerts.some((a) => a.icon === "bottleneck" && a.detail === "alice")).toBe(true);
  });

  it("detects sprint at risk", () => {
    const sprint: SprintConfig = {
      number: 1,
      name: "Sprint 1",
      startDate: "2026-02-01",
      endDate: "2026-02-17", // ~82% elapsed
      focus: "test",
    };
    const tasks = [{ state: "open" }, { state: "open" }, { state: "open" }, { state: "closed" }]; // 25% done
    const alerts = computeAlerts([], tasks, sprint, 5);
    expect(alerts.some((a) => a.icon === "sprint-risk")).toBe(true);
  });

  it("detects large PR backlog", () => {
    const prs = Array.from({ length: 11 }, () => ({
      created_at: "2026-02-15T10:00:00Z",
      requested_reviewers: [{ login: "a" }],
      draft: false,
    }));
    const alerts = computeAlerts(prs, [], null, 5); // 11 PRs for 5 members → >2x
    expect(alerts.some((a) => a.icon === "backlog")).toBe(true);
  });

  it("caps at 5 alerts", () => {
    // Create conditions for many alerts simultaneously
    const prs = Array.from({ length: 20 }, () => ({
      created_at: "2026-02-01T10:00:00Z",
      requested_reviewers: [],
      draft: false,
    }));
    const sprint: SprintConfig = {
      number: 1,
      name: "S1",
      startDate: "2026-02-01",
      endDate: "2026-02-17",
      focus: "",
    };
    const tasks = Array.from({ length: 10 }, () => ({ state: "open" }));
    const alerts = computeAlerts(prs, tasks, sprint, 5);
    expect(alerts.length).toBeLessThanOrEqual(5);
  });
});

// ── computeVelocityTrend ───────────────────────────────────────────
describe("computeVelocityTrend", () => {
  it("returns empty for no snapshots", () => {
    const result = computeVelocityTrend([]);
    expect(result.history).toEqual([]);
    expect(result.average).toBe(0);
  });

  it("computes average from sprint snapshots", () => {
    const snapshots = [
      { sprintNumber: 1, name: "S1", metrics: { donePoints: 20 } },
      { sprintNumber: 2, name: "S2", metrics: { donePoints: 30 } },
      { sprintNumber: 3, name: "S3", metrics: { donePoints: 40 } },
    ];
    const result = computeVelocityTrend(snapshots);
    expect(result.average).toBe(30);
    expect(result.history).toHaveLength(3);
    expect(result.history[0].weekStart).toBe("S1");
  });

  it("only uses last 6 sprints", () => {
    const snapshots = Array.from({ length: 10 }, (_, i) => ({
      sprintNumber: i + 1,
      name: `S${i + 1}`,
      metrics: { donePoints: 10 },
    }));
    const result = computeVelocityTrend(snapshots);
    expect(result.history).toHaveLength(6);
  });
});
