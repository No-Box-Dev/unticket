import { getOctokit } from "./github";
import type { SprintConfig, Feature, Person, OrgSettings } from "./types";

const REPO_NAME = ".gitpulse";

async function getFileContent<T>(org: string, path: string): Promise<{ data: T; sha: string } | null> {
  const ok = getOctokit();
  try {
    const { data } = await ok.rest.repos.getContent({ owner: org, repo: REPO_NAME, path });
    if ("content" in data && typeof data.content === "string") {
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
  const encoded = btoa(JSON.stringify(content, null, 2));
  await ok.rest.repos.createOrUpdateFileContents({
    owner: org,
    repo: REPO_NAME,
    path,
    message: message ?? `Update ${path}`,
    content: encoded,
    ...(sha ? { sha } : {}),
  });
}

// Sprint
export async function fetchSprint(org: string): Promise<SprintConfig | null> {
  const result = await getFileContent<SprintConfig>(org, "sprint.json");
  return result?.data ?? null;
}

export async function saveSprint(org: string, sprint: SprintConfig) {
  const existing = await getFileContent<SprintConfig>(org, "sprint.json");
  await putFileContent(org, "sprint.json", sprint, existing?.sha, `Update sprint ${sprint.number}`);
}

// Features
export async function fetchFeatures(org: string): Promise<Feature[]> {
  const result = await getFileContent<Feature[]>(org, "features.json");
  return result?.data ?? [];
}

export async function saveFeatures(org: string, features: Feature[]) {
  const existing = await getFileContent<Feature[]>(org, "features.json");
  await putFileContent(org, "features.json", features, existing?.sha, "Update features");
}

// People
export async function fetchPeople(org: string): Promise<Person[]> {
  const result = await getFileContent<Person[]>(org, "people.json");
  return result?.data ?? [];
}

export async function savePeople(org: string, people: Person[]) {
  const existing = await getFileContent<Person[]>(org, "people.json");
  await putFileContent(org, "people.json", people, existing?.sha, "Update people");
}

// Settings
export async function fetchSettings(org: string): Promise<OrgSettings | null> {
  const result = await getFileContent<OrgSettings>(org, "settings.json");
  return result?.data ?? null;
}

export async function saveSettings(org: string, settings: OrgSettings) {
  const existing = await getFileContent<OrgSettings>(org, "settings.json");
  await putFileContent(org, "settings.json", settings, existing?.sha, "Update settings");
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
