import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  apiPut: vi.fn(),
}));

vi.mock("@/lib/gitpulse-repo", () => ({
  fetchPlanFile: vi.fn(),
  planFilePath: vi.fn(),
}));

import { apiGet, apiPut } from "@/lib/api";
import {
  fetchFeatures,
  fetchPeople,
  fetchSettings,
  fetchTodos,
  createConfigRepo,
} from "../config-repo";

const mockApiGet = vi.mocked(apiGet);
const mockApiPut = vi.mocked(apiPut);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchFeatures", () => {
  it("migrates 'active' → 'plan'", async () => {
    mockApiGet.mockResolvedValue([
      { id: "f1", title: "A", status: "active", owners: [], sprint: 1, effort: "low" },
    ]);
    const result = await fetchFeatures();
    expect(result[0].status).toBe("plan");
  });

  it("migrates 'done' → 'production'", async () => {
    mockApiGet.mockResolvedValue([
      { id: "f2", title: "B", status: "done", owners: [], sprint: 1, effort: "low" },
    ]);
    const result = await fetchFeatures();
    expect(result[0].status).toBe("production");
  });

  it("leaves valid statuses unchanged", async () => {
    mockApiGet.mockResolvedValue([
      { id: "f3", title: "C", status: "demo", owners: [], sprint: 1, effort: "low" },
    ]);
    const result = await fetchFeatures();
    expect(result[0].status).toBe("demo");
  });

  it("returns [] when API returns null", async () => {
    mockApiGet.mockResolvedValue(null);
    const result = await fetchFeatures();
    expect(result).toEqual([]);
  });
});

describe("fetchPeople", () => {
  it("migrates legacy 'team' string to 'teams' array", async () => {
    mockApiGet.mockResolvedValue([
      { github: "alice", name: "Alice", role: "dev", team: "Backend" },
    ]);
    const result = await fetchPeople();
    expect(result[0].teams).toEqual(["Backend"]);
  });

  it("keeps existing teams array", async () => {
    mockApiGet.mockResolvedValue([
      { github: "bob", name: "Bob", role: "dev", teams: ["Frontend", "Design"] },
    ]);
    const result = await fetchPeople();
    expect(result[0].teams).toEqual(["Frontend", "Design"]);
  });

  it("returns [] when API returns null", async () => {
    mockApiGet.mockResolvedValue(null);
    const result = await fetchPeople();
    expect(result).toEqual([]);
  });
});

describe("fetchSettings", () => {
  it("adds repos:[] to teams missing it and draftRepos:[]", async () => {
    mockApiGet.mockResolvedValue({
      teams: [{ name: "Team", color: "#fff" }],
    });
    const result = await fetchSettings();
    expect(result!.teams[0].repos).toEqual([]);
    expect(result!.draftRepos).toEqual([]);
  });

  it("returns null when API returns null", async () => {
    mockApiGet.mockResolvedValue(null);
    const result = await fetchSettings();
    expect(result).toBeNull();
  });
});

describe("fetchTodos", () => {
  it("returns [] when API returns null", async () => {
    mockApiGet.mockResolvedValue(null);
    const result = await fetchTodos();
    expect(result).toEqual([]);
  });
});

describe("createConfigRepo", () => {
  it("computes next Monday correctly", async () => {
    // Wednesday 2026-02-18
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-18T12:00:00Z"));

    mockApiPut.mockResolvedValue(undefined);
    await createConfigRepo();

    const sprintCall = mockApiPut.mock.calls.find(
      (c) => c[0] === "/api/config/sprint",
    );
    expect(sprintCall).toBeDefined();
    const sprint = sprintCall![1] as { startDate: string; endDate: string };
    // Next Monday from Wednesday Feb 18 is Feb 23
    expect(sprint.startDate).toBe("2026-02-23");
    // 13 days later
    expect(sprint.endDate).toBe("2026-03-08");

    vi.useRealTimers();
  });

  it("seeds all 5 config keys via apiPut", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-18T12:00:00Z"));

    mockApiPut.mockResolvedValue(undefined);
    await createConfigRepo();

    const paths = mockApiPut.mock.calls.map((c) => c[0]);
    expect(paths).toContain("/api/config/sprint");
    expect(paths).toContain("/api/config/features");
    expect(paths).toContain("/api/config/people");
    expect(paths).toContain("/api/config/settings");
    expect(paths).toContain("/api/config/todos");
    expect(mockApiPut).toHaveBeenCalledTimes(5);

    vi.useRealTimers();
  });
});
