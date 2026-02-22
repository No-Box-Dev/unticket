import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

import { apiGet } from "@/lib/api";
import {
  getOctokit,
  resetOctokit,
  fetchRepos,
  fetchOpenPRs,
  fetchMergedPRs,
  fetchOpenIssues,
  fetchClosedIssues,
  fetchOrgMembers,
  fetchMilestones,
  fetchRepoActivity,
} from "../github";

const mockApiGet = vi.mocked(apiGet);

let storage: Record<string, string> = {};

beforeEach(() => {
  vi.clearAllMocks();
  resetOctokit();
  storage = {};

  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, val: string) => { storage[key] = val; },
    removeItem: (key: string) => { delete storage[key]; },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------- Octokit ----------

describe("getOctokit", () => {
  it("throws when no token", () => {
    expect(() => getOctokit()).toThrow("Not authenticated");
  });

  it("creates and caches singleton Octokit", () => {
    storage.gp_token = "tok";
    const a = getOctokit();
    const b = getOctokit();
    expect(a).toBe(b);
  });

  it("resetOctokit causes new instance on next call", () => {
    storage.gp_token = "tok";
    const a = getOctokit();
    resetOctokit();
    const b = getOctokit();
    expect(a).not.toBe(b);
  });
});

// ---------- fetchRepos ----------

describe("fetchRepos", () => {
  it("maps ApiRepo to RepoInfo shape with id=0 and visibility=private", async () => {
    mockApiGet.mockResolvedValue([
      { name: "repo-a", language: "TypeScript", pushed_at: "2026-01-01" },
    ]);

    const repos = await fetchRepos();
    expect(repos).toEqual([
      {
        id: 0,
        name: "repo-a",
        full_name: "repo-a",
        description: null,
        open_issues_count: 0,
        pushed_at: "2026-01-01",
        language: "TypeScript",
        visibility: "private",
      },
    ]);
  });
});

// ---------- fetchOpenPRs ----------

describe("fetchOpenPRs", () => {
  it("transforms author → user object", async () => {
    mockApiGet.mockResolvedValue([
      {
        id: 1, repo: "r", number: 10, title: "PR", state: "open",
        author: "alice", author_avatar: "https://img/alice",
        draft: false, head_ref: "feat", base_ref: "main",
        merged_at: null, created_at: "2026-01-01", updated_at: "2026-01-02",
        html_url: "https://github.com/org/r/pull/10",
        requested_reviewers: [], labels: [],
      },
    ]);

    const prs = await fetchOpenPRs();
    expect(prs[0].user).toEqual({ login: "alice", avatar_url: "https://img/alice" });
  });

  it("null author → null user", async () => {
    mockApiGet.mockResolvedValue([
      {
        id: 2, repo: "r", number: 11, title: "PR2", state: "open",
        author: null, author_avatar: null,
        draft: false, head_ref: null, base_ref: null,
        merged_at: null, created_at: "2026-01-01", updated_at: "2026-01-02",
        html_url: "https://github.com/org/r/pull/11",
        requested_reviewers: [], labels: [],
      },
    ]);

    const prs = await fetchOpenPRs();
    expect(prs[0].user).toBeNull();
  });

  it("maps head.repo from pr.repo string", async () => {
    mockApiGet.mockResolvedValue([
      {
        id: 3, repo: "my-repo", number: 12, title: "PR3", state: "open",
        author: "bob", author_avatar: "",
        draft: false, head_ref: "feat-x", base_ref: "main",
        merged_at: null, created_at: "2026-01-01", updated_at: "2026-01-02",
        html_url: "https://github.com/org/my-repo/pull/12",
        requested_reviewers: [], labels: [],
      },
    ]);

    const prs = await fetchOpenPRs();
    expect(prs[0].head.repo).toEqual({ name: "my-repo", full_name: "my-repo" });
  });
});

// ---------- fetchMergedPRs ----------

describe("fetchMergedPRs", () => {
  it("passes 'since' to query string", async () => {
    mockApiGet.mockResolvedValue([]);
    await fetchMergedPRs("2026-01-15");
    expect(mockApiGet).toHaveBeenCalledWith(
      expect.stringContaining("since=2026-01-15"),
    );
  });
});

// ---------- fetchOpenIssues ----------

describe("fetchOpenIssues", () => {
  it("transforms milestone_title → milestone object", async () => {
    mockApiGet.mockResolvedValue([
      {
        id: 1, repo: "r", number: 5, title: "Issue", state: "open",
        author: "alice", author_avatar: "https://img/alice",
        created_at: "2026-01-01", updated_at: "2026-01-02", closed_at: null,
        html_url: "https://github.com/org/r/issues/5",
        assignees: [], labels: [],
        milestone_title: "v1.0",
      },
    ]);

    const issues = await fetchOpenIssues();
    expect(issues[0].milestone).toEqual({ title: "v1.0" });
  });

  it("maps assignees with fallback avatar", async () => {
    mockApiGet.mockResolvedValue([
      {
        id: 2, repo: "r", number: 6, title: "Issue2", state: "open",
        author: "bob", author_avatar: "",
        created_at: "2026-01-01", updated_at: "2026-01-02", closed_at: null,
        html_url: "https://github.com/org/r/issues/6",
        assignees: [{ login: "charlie" }],
        labels: [], milestone_title: null,
      },
    ]);

    const issues = await fetchOpenIssues();
    expect(issues[0].assignees).toEqual([{ login: "charlie", avatar_url: "" }]);
  });
});

// ---------- fetchClosedIssues ----------

describe("fetchClosedIssues", () => {
  it("passes closed_since param", async () => {
    mockApiGet.mockResolvedValue([]);
    await fetchClosedIssues("2026-01-10");
    expect(mockApiGet).toHaveBeenCalledWith(
      expect.stringContaining("closed_since=2026-01-10"),
    );
  });
});

// ---------- fetchOrgMembers ----------

describe("fetchOrgMembers", () => {
  it("maps to {login, avatar_url, id:0, type:'User'}", async () => {
    mockApiGet.mockResolvedValue([
      { login: "alice", avatar_url: "https://img/alice" },
      { login: "bob", avatar_url: null },
    ]);

    const members = await fetchOrgMembers();
    expect(members).toEqual([
      { login: "alice", avatar_url: "https://img/alice", id: 0, type: "User" },
      { login: "bob", avatar_url: "", id: 0, type: "User" },
    ]);
  });
});

// ---------- Static returns ----------

describe("fetchMilestones / fetchRepoActivity", () => {
  it("fetchMilestones returns []", async () => {
    expect(await fetchMilestones()).toEqual([]);
  });

  it("fetchRepoActivity returns []", async () => {
    expect(await fetchRepoActivity()).toEqual([]);
  });
});
