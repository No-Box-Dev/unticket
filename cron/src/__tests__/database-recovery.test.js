import { afterEach, describe, expect, it, vi } from "vitest";
import { databaseRecoveryInternals } from "../database-recovery.js";

afterEach(() => vi.unstubAllGlobals());

describe("database recovery GitHub enumeration", () => {
  it("paginates every repository visible to an installation", async () => {
    const first = Array.from({ length: 100 }, (_, index) => ({
      name: `repo-${index}`,
      owner: { login: "acme" },
    }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ repositories: first }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        repositories: [{ name: "repo-100", owner: { login: "acme" } }],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const repos = await databaseRecoveryInternals.fetchInstallationRepos("token");

    expect(repos).toHaveLength(101);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain("page=2");
  });

  it("fails loudly instead of treating a GitHub error as an empty installation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("forbidden", { status: 403 })));
    await expect(databaseRecoveryInternals.fetchInstallationRepos("token")).rejects.toThrow(
      "installation repositories failed (403)",
    );
  });
});
