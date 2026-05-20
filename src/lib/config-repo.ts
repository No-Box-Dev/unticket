import { apiGet, apiPut } from "./api";
import type { Person, OrgSettings } from "./types";

// People (D1-backed via /api/config/people)
export async function fetchPeople(): Promise<Person[]> {
  const people = await apiGet<Person[] | null>("/api/config/people");
  return people ?? [];
}

export async function savePeople(people: Person[]): Promise<void> {
  await apiPut("/api/config/people", people);
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
