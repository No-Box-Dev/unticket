import { getOctokit } from "./github";
import type { SprintConfig, Feature, Person, OrgSettings } from "./types";

const REPO_NAME = ".gitpulse";

// SHA cache to avoid fetching before every write
const shaCache = new Map<string, string>();

async function getFileContent<T>(org: string, path: string): Promise<{ data: T; sha: string } | null> {
  const ok = getOctokit();
  try {
    const { data } = await ok.rest.repos.getContent({ owner: org, repo: REPO_NAME, path });
    if ("content" in data && typeof data.content === "string") {
      const cacheKey = `${org}/${path}`;
      shaCache.set(cacheKey, data.sha);
      const decoded = JSON.parse(atob(data.content)) as T;
      return { data: decoded, sha: data.sha };
    }
    return null;
  } catch (e: any) {
    if (e.status === 404) return null;
    throw e;
  }
}

async function putFileContent(org: string, path: string, content: unknown, sha?: string, message?: string) {
  const ok = getOctokit();
  const cacheKey = `${org}/${path}`;
  const resolvedSha = sha ?? shaCache.get(cacheKey);
  const encoded = btoa(JSON.stringify(content, null, 2));
  const { data } = await ok.rest.repos.createOrUpdateFileContents({
    owner: org,
    repo: REPO_NAME,
    path,
    message: message ?? `Update ${path}`,
    content: encoded,
    ...(resolvedSha ? { sha: resolvedSha } : {}),
  });
  // Update cache with new SHA
  if (data.content?.sha) {
    shaCache.set(cacheKey, data.content.sha);
  }
}

// Sprint
export async function fetchSprint(org: string): Promise<SprintConfig | null> {
  const result = await getFileContent<SprintConfig>(org, "sprint.json");
  return result?.data ?? null;
}

export async function saveSprint(org: string, sprint: SprintConfig) {
  await putFileContent(org, "sprint.json", sprint, undefined, `Update sprint ${sprint.number}`);
}

// Features
export async function fetchFeatures(org: string): Promise<Feature[]> {
  const result = await getFileContent<Feature[]>(org, "features.json");
  return result?.data ?? [];
}

export async function saveFeatures(org: string, features: Feature[]) {
  await putFileContent(org, "features.json", features, undefined, "Update features");
}

// People
export async function fetchPeople(org: string): Promise<Person[]> {
  const result = await getFileContent<Person[]>(org, "people.json");
  if (!result?.data) return [];
  // Normalize: migrate legacy `team` string → `teams` array
  return result.data.map((p: any) => ({
    ...p,
    teams: p.teams ?? (p.team ? [p.team] : []),
  }));
}

export async function savePeople(org: string, people: Person[]) {
  await putFileContent(org, "people.json", people, undefined, "Update people");
}

// Settings
export async function fetchSettings(org: string): Promise<OrgSettings | null> {
  const result = await getFileContent<OrgSettings>(org, "settings.json");
  if (!result?.data) return null;
  // Normalize teams: add repos[] if missing (backward compat)
  const settings = result.data;
  settings.teams = settings.teams.map((t) => ({ ...t, repos: t.repos ?? [] }));
  return settings;
}

export async function saveSettings(org: string, settings: OrgSettings) {
  await putFileContent(org, "settings.json", settings, undefined, "Update settings");
}

// Ensure .gitpulse repo exists
export async function ensureConfigRepo(org: string): Promise<boolean> {
  const ok = getOctokit();
  try {
    await ok.rest.repos.get({ owner: org, repo: REPO_NAME });
    return true;
  } catch (e: any) {
    if (e.status === 404) return false;
    throw e;
  }
}

// Create .gitpulse repo with default sprint.json
export async function createConfigRepo(org: string): Promise<void> {
  const ok = getOctokit();

  // Create the repo under the org
  await ok.rest.repos.createInOrg({
    org,
    name: REPO_NAME,
    description: "GitPulse configuration — sprint, features, people",
    private: true,
    auto_init: true,
  });

  // Seed with default sprint.json
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + 14);

  const defaultSprint: SprintConfig = {
    number: 1,
    name: "Getting Started",
    startDate: now.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    focus: "Set up your first sprint",
  };

  const encoded = btoa(JSON.stringify(defaultSprint, null, 2));
  await ok.rest.repos.createOrUpdateFileContents({
    owner: org,
    repo: REPO_NAME,
    path: "sprint.json",
    message: "Initialize sprint.json",
    content: encoded,
  });

  // Seed empty features.json
  await ok.rest.repos.createOrUpdateFileContents({
    owner: org,
    repo: REPO_NAME,
    path: "features.json",
    message: "Initialize features.json",
    content: btoa("[]"),
  });

  // Seed empty people.json
  await ok.rest.repos.createOrUpdateFileContents({
    owner: org,
    repo: REPO_NAME,
    path: "people.json",
    message: "Initialize people.json",
    content: btoa("[]"),
  });

  // Seed default settings.json
  const defaultSettings: OrgSettings = {
    teams: [{ name: "Team", color: "#1B6971", repos: [] }],
  };
  await ok.rest.repos.createOrUpdateFileContents({
    owner: org,
    repo: REPO_NAME,
    path: "settings.json",
    message: "Initialize settings.json",
    content: btoa(JSON.stringify(defaultSettings, null, 2)),
  });
}
