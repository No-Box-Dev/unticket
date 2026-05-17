import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockOctokit = {
  rest: {
    repos: {
      get: vi.fn(),
      createInOrg: vi.fn(),
      createOrUpdateFileContents: vi.fn(),
      getContent: vi.fn(),
    },
  },
};

vi.mock("../github", () => ({
  getOctokit: () => mockOctokit,
}));

vi.mock("../unticket-repo-name", () => ({
  getUnticketRepoName: () => "unticket",
}));

import {
  ensureUnticketRepo,
  createUnticketRepo,
  planFilePath,
  fetchPlanFile,
  savePlanFile,
  fetchPeopleFromRepo,
  savePeopleToRepo,
} from "../unticket-repo";

beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("ensureUnticketRepo", () => {
  it("returns true when the repo exists", async () => {
    mockOctokit.rest.repos.get.mockResolvedValue({ data: { name: "unticket" } });
    await expect(ensureUnticketRepo("org")).resolves.toBe(true);
  });

  it("returns false when GitHub responds with 404", async () => {
    mockOctokit.rest.repos.get.mockRejectedValue(
      Object.assign(new Error("Not Found"), { status: 404 }),
    );
    await expect(ensureUnticketRepo("org")).resolves.toBe(false);
  });

  it("rethrows non-404 errors", async () => {
    mockOctokit.rest.repos.get.mockRejectedValue(
      Object.assign(new Error("Server Error"), { status: 500 }),
    );
    await expect(ensureUnticketRepo("org")).rejects.toThrow("Server Error");
  });
});

describe("createUnticketRepo", () => {
  it("creates a private repo and seeds CLAUDE.md + plans/.gitkeep", async () => {
    mockOctokit.rest.repos.createInOrg.mockResolvedValue({});
    mockOctokit.rest.repos.createOrUpdateFileContents.mockResolvedValue({});
    await createUnticketRepo("org");
    expect(mockOctokit.rest.repos.createInOrg).toHaveBeenCalledWith(expect.objectContaining({
      org: "org",
      name: "unticket",
      private: true,
      auto_init: true,
    }));
    const filePaths = mockOctokit.rest.repos.createOrUpdateFileContents.mock.calls.map(
      (c) => c[0].path,
    );
    expect(filePaths).toContain("CLAUDE.md");
    expect(filePaths).toContain("plans/.gitkeep");
  });
});

describe("planFilePath", () => {
  it("formats as plans/PLAN-{id}.md", () => {
    expect(planFilePath("42")).toBe("plans/PLAN-42.md");
  });
});

describe("fetchPlanFile", () => {
  it("returns null when file is missing (404)", async () => {
    mockOctokit.rest.repos.getContent.mockRejectedValue(
      Object.assign(new Error("Not Found"), { status: 404 }),
    );
    await expect(fetchPlanFile("org", "42")).resolves.toBeNull();
  });

  it("decodes base64 content from existing file", async () => {
    mockOctokit.rest.repos.getContent.mockResolvedValue({
      data: { type: "file", content: btoa("Hello plan") },
    });
    await expect(fetchPlanFile("org", "42")).resolves.toEqual({ content: "Hello plan" });
  });

  it("rethrows non-404 errors", async () => {
    mockOctokit.rest.repos.getContent.mockRejectedValue(
      Object.assign(new Error("forbidden"), { status: 403 }),
    );
    await expect(fetchPlanFile("org", "42")).rejects.toThrow("forbidden");
  });
});

describe("savePlanFile", () => {
  it("PUTs a new file when the path is missing (no SHA passed)", async () => {
    mockOctokit.rest.repos.getContent.mockRejectedValue(
      Object.assign(new Error("Not Found"), { status: 404 }),
    );
    mockOctokit.rest.repos.createOrUpdateFileContents.mockResolvedValue({});
    await savePlanFile("org", "42", "Plan content");
    const [args] = mockOctokit.rest.repos.createOrUpdateFileContents.mock.calls[0];
    expect(args.path).toBe("plans/PLAN-42.md");
    expect(args.sha).toBeUndefined();
    expect(args.content).toBe(btoa("Plan content"));
  });

  it("PUTs with SHA when the file already exists", async () => {
    mockOctokit.rest.repos.getContent.mockResolvedValue({
      data: { type: "file", content: "", sha: "abc123" },
    });
    mockOctokit.rest.repos.createOrUpdateFileContents.mockResolvedValue({});
    await savePlanFile("org", "42", "Updated");
    const [args] = mockOctokit.rest.repos.createOrUpdateFileContents.mock.calls[0];
    expect(args.sha).toBe("abc123");
  });
});

describe("fetchPeopleFromRepo", () => {
  it("returns parsed JSON from config/people.json", async () => {
    mockOctokit.rest.repos.getContent.mockResolvedValue({
      data: { type: "file", content: btoa(JSON.stringify([{ github: "x", name: "X", role: "Eng" }])) },
    });
    await expect(fetchPeopleFromRepo("org")).resolves.toEqual([
      { github: "x", name: "X", role: "Eng" },
    ]);
  });

  it("returns [] when the file is missing", async () => {
    mockOctokit.rest.repos.getContent.mockRejectedValue(
      Object.assign(new Error("Not Found"), { status: 404 }),
    );
    await expect(fetchPeopleFromRepo("org")).resolves.toEqual([]);
  });

  it("returns [] and logs on parse failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockOctokit.rest.repos.getContent.mockResolvedValue({
      data: { type: "file", content: btoa("not json") },
    });
    await expect(fetchPeopleFromRepo("org")).resolves.toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("savePeopleToRepo", () => {
  it("serializes people array as pretty JSON and PUTs to config/people.json", async () => {
    mockOctokit.rest.repos.getContent.mockRejectedValue(
      Object.assign(new Error("Not Found"), { status: 404 }),
    );
    mockOctokit.rest.repos.createOrUpdateFileContents.mockResolvedValue({});
    await savePeopleToRepo("org", [{ github: "x", name: "X", role: "eng" }]);
    const [args] = mockOctokit.rest.repos.createOrUpdateFileContents.mock.calls[0];
    expect(args.path).toBe("config/people.json");
    const decoded = atob(args.content);
    expect(JSON.parse(decoded)).toEqual([{ github: "x", name: "X", role: "eng" }]);
    expect(decoded).toContain("\n  ");  // pretty-printed
  });
});
