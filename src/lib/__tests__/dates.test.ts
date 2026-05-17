import { describe, it, expect, vi, afterEach } from "vitest";
import { daysAgo, STALE_ISSUE_DAYS, STALE_PR_DAYS } from "../dates";

afterEach(() => vi.useRealTimers());

describe("daysAgo", () => {
  it("returns 0 for now", () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-05-17T12:00:00Z"));
    expect(daysAgo("2026-05-17T12:00:00Z")).toBe(0);
  });

  it("returns whole-day count for past dates", () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-05-17T12:00:00Z"));
    expect(daysAgo("2026-05-10T12:00:00Z")).toBe(7);
    expect(daysAgo("2026-04-17T12:00:00Z")).toBe(30);
  });

  it("floors fractional days", () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-05-17T12:00:00Z"));
    // 23 hours ago = still 0 days
    expect(daysAgo("2026-05-16T13:00:00Z")).toBe(0);
    // 25 hours ago = 1 day
    expect(daysAgo("2026-05-16T11:00:00Z")).toBe(1);
  });

  it("returns a negative number for future dates", () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-05-17T12:00:00Z"));
    expect(daysAgo("2026-05-18T12:00:00Z")).toBe(-1);
  });
});

describe("stale thresholds", () => {
  it("exports the documented constants", () => {
    expect(STALE_ISSUE_DAYS).toBe(30);
    expect(STALE_PR_DAYS).toBe(7);
  });
});
