import { apiGet, apiPut } from "./api";
import { fetchPeopleFromRepo, savePeopleToRepo } from "./unticket-repo";
import type { SprintConfig, Person, OrgSettings, SprintSnapshot } from "./types";

// Sprint
export async function fetchSprint(): Promise<SprintConfig | null> {
  return apiGet<SprintConfig | null>("/api/config/sprint");
}

export async function saveSprint(sprint: SprintConfig) {
  await apiPut("/api/config/sprint", sprint);
}

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

// Agent Rules
export async function fetchAgentRules(): Promise<string[]> {
  const data = await apiGet<string[]>("/api/config/agentRules");
  return data ?? [];
}

export async function saveAgentRules(rules: string[]) {
  await apiPut("/api/config/agentRules", rules);
}

// Sprint Snapshots
export async function fetchSprintSnapshots(): Promise<SprintSnapshot[]> {
  const data = await apiGet<SprintSnapshot[]>("/api/config/sprintSnapshots");
  return data ?? [];
}

export async function saveSprintSnapshots(snapshots: SprintSnapshot[]) {
  await apiPut("/api/config/sprintSnapshots", snapshots);
}

// Config repo management — D1 is always available
export async function ensureConfigRepo(): Promise<boolean> {
  return true;
}

export async function createConfigRepo(): Promise<void> {
  // Seed D1 with defaults
  // Start next Monday, run 2 weeks
  const now = new Date();
  const daysUntilMonday = (8 - now.getDay()) % 7 || 7;
  const start = new Date(now.getTime() + daysUntilMonday * 86400000);
  const end = new Date(start.getTime() + 13 * 86400000);
  await apiPut("/api/config/sprint", {
    number: 1,
    name: "Getting Started",
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    focus: "Set up your first sprint",
  });
  await apiPut("/api/config/people", []);
  await apiPut("/api/config/settings", {});
}
