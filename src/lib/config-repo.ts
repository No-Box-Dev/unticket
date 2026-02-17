import { apiGet, apiPut } from "./api";
import type { SprintConfig, Feature, Person, OrgSettings, Todo } from "./types";

// Sprint
export async function fetchSprint(): Promise<SprintConfig | null> {
  return apiGet<SprintConfig | null>("/api/config/sprint");
}

export async function saveSprint(sprint: SprintConfig) {
  await apiPut("/api/config/sprint", sprint);
}

// Features
export async function fetchFeatures(): Promise<Feature[]> {
  const data = await apiGet<Feature[] | null>("/api/config/features");
  return data ?? [];
}

export async function saveFeatures(features: Feature[]) {
  await apiPut("/api/config/features", features);
}

// People
export async function fetchPeople(): Promise<Person[]> {
  const data = await apiGet<Person[] | null>("/api/config/people");
  if (!data) return [];
  // Normalize: migrate legacy `team` string → `teams` array
  return data.map((p) => ({
    ...p,
    teams: p.teams ?? (p.team ? [p.team] : []),
  }));
}

export async function savePeople(people: Person[]) {
  await apiPut("/api/config/people", people);
}

// Settings
export async function fetchSettings(): Promise<OrgSettings | null> {
  const settings = await apiGet<OrgSettings | null>("/api/config/settings");
  if (!settings) return null;
  // Normalize teams: add repos[] if missing (backward compat)
  settings.teams = settings.teams.map((t) => ({ ...t, repos: t.repos ?? [] }));
  settings.draftRepos = settings.draftRepos ?? [];
  return settings;
}

export async function saveSettings(settings: OrgSettings) {
  await apiPut("/api/config/settings", settings);
}

// Todos
export async function fetchTodos(): Promise<Todo[]> {
  const data = await apiGet<Todo[] | null>("/api/config/todos");
  return data ?? [];
}

export async function saveTodos(todos: Todo[]) {
  await apiPut("/api/config/todos", todos);
}

// Config repo is no longer needed — D1 stores config
// These are kept for backward compatibility during migration
export async function ensureConfigRepo(): Promise<boolean> {
  // With D1 backend, config is always available
  return true;
}

export async function createConfigRepo(): Promise<void> {
  // Seed default config via D1
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

  await saveSprint(defaultSprint);
  await saveFeatures([]);
  await savePeople([]);
  await saveSettings({
    teams: [{ name: "Team", color: "#1B6971", repos: [] }],
  });
}
