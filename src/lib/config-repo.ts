import { apiGet, apiPut } from "./api";
import { fetchPeopleFromRepo, savePeopleToRepo } from "./unticket-repo";
import type { Person, OrgSettings } from "./types";

// People (GitHub-backed via unticket repo)
export async function fetchPeople(org: string): Promise<Person[]> {
  return fetchPeopleFromRepo(org);
}

export async function savePeople(org: string, people: Person[]): Promise<void> {
  return savePeopleToRepo(org, people);
}

// Settings
export async function fetchSettings(): Promise<OrgSettings | null> {
  const settings = await apiGet<OrgSettings | null>("/api/config/settings");
  if (!settings) return null;
  settings.draftRepos = settings.draftRepos ?? [];
  return settings;
}

export async function saveSettings(settings: OrgSettings) {
  await apiPut("/api/config/settings", settings);
}

// Config repo management — D1 is always available
export async function ensureConfigRepo(): Promise<boolean> {
  return true;
}

export async function createConfigRepo(): Promise<void> {
  await apiPut("/api/config/people", []);
  await apiPut("/api/config/settings", {});
}
