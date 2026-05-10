import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  apiPut: vi.fn(),
}));

vi.mock("@/lib/unticket-repo", () => ({
  fetchPeopleFromRepo: vi.fn(),
  savePeopleToRepo: vi.fn(),
}));

import { apiGet, apiPut } from "@/lib/api";
import { fetchPeopleFromRepo } from "@/lib/unticket-repo";
import {
  fetchPeople,
  fetchSettings,
  createConfigRepo,
} from "../config-repo";

const mockApiGet = vi.mocked(apiGet);
const mockApiPut = vi.mocked(apiPut);
const mockFetchPeopleFromRepo = vi.mocked(fetchPeopleFromRepo);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchPeople (GitHub-backed)", () => {
  it("delegates to fetchPeopleFromRepo", async () => {
    mockFetchPeopleFromRepo.mockResolvedValue([
      { github: "alice", name: "Alice", role: "dev", team: "Backend" },
    ]);
    const result = await fetchPeople("test-org");
    expect(mockFetchPeopleFromRepo).toHaveBeenCalledWith("test-org");
    expect(result[0].team).toEqual("Backend");
  });
});

describe("fetchSettings", () => {
  it("normalizes draftRepos to []", async () => {
    mockApiGet.mockResolvedValue({});
    const result = await fetchSettings();
    expect(result!.draftRepos).toEqual([]);
  });

  it("returns null when API returns null", async () => {
    mockApiGet.mockResolvedValue(null);
    const result = await fetchSettings();
    expect(result).toBeNull();
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

  it("seeds 3 config keys via apiPut", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-18T12:00:00Z"));

    mockApiPut.mockResolvedValue(undefined);
    await createConfigRepo();

    const paths = mockApiPut.mock.calls.map((c) => c[0]);
    expect(paths).toContain("/api/config/sprint");
    expect(paths).toContain("/api/config/people");
    expect(paths).toContain("/api/config/settings");
    expect(paths).not.toContain("/api/config/features");
    expect(paths).not.toContain("/api/config/todos");
    expect(mockApiPut).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
  });
});
