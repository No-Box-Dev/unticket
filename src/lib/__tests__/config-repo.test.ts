import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  apiPut: vi.fn(),
}));

import { apiGet, apiPut } from "@/lib/api";
import {
  fetchPeople,
  savePeople,
  fetchSettings,
  createConfigRepo,
} from "../config-repo";

const mockApiGet = vi.mocked(apiGet);
const mockApiPut = vi.mocked(apiPut);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchPeople (D1-backed)", () => {
  it("reads from /api/config/people", async () => {
    mockApiGet.mockResolvedValue([
      { github: "alice", name: "Alice", role: "dev", team: "Backend" },
    ]);
    const result = await fetchPeople();
    expect(mockApiGet).toHaveBeenCalledWith("/api/config/people");
    expect(result[0].team).toEqual("Backend");
  });

  it("returns [] when the row is missing", async () => {
    mockApiGet.mockResolvedValue(null);
    const result = await fetchPeople();
    expect(result).toEqual([]);
  });
});

describe("savePeople (D1-backed)", () => {
  it("writes to /api/config/people", async () => {
    mockApiPut.mockResolvedValue(undefined);
    const people = [{ github: "alice", name: "Alice", role: "dev", team: "Backend" }];
    await savePeople(people);
    expect(mockApiPut).toHaveBeenCalledWith("/api/config/people", people);
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
  it("seeds 2 config keys via apiPut", async () => {
    mockApiPut.mockResolvedValue(undefined);
    await createConfigRepo();

    const paths = mockApiPut.mock.calls.map((c) => c[0]);
    expect(paths).toContain("/api/config/people");
    expect(paths).toContain("/api/config/settings");
    expect(paths).not.toContain("/api/config/sprint");
    expect(paths).not.toContain("/api/config/features");
    expect(mockApiPut).toHaveBeenCalledTimes(2);
  });
});
