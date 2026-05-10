import { getOctokit } from "./github";
import type { Person } from "./types";

const REPO_NAME = "unticket";

// ---------- Repo management ----------

export async function ensureUnticketRepo(org: string): Promise<boolean> {
  const ok = getOctokit();
  try {
    await ok.rest.repos.get({ owner: org, repo: REPO_NAME });
    return true;
  } catch (e: unknown) {
    if (e && typeof e === "object" && "status" in e && (e as { status: number }).status === 404) {
      return false;
    }
    throw e;
  }
}

const CLAUDE_MD = `# unticket

Central config and plans repository for [unticket.ai](https://app.unticket.ai).

## Structure

\`\`\`
config/
  people.json       # Team members: name, role, teams per GitHub login
plans/
  PLAN-*.md         # Implementation plans per feature (e.g. PLAN-42.md)
  TODO-*.md         # Implementation plans per todo (e.g. TODO-123.md)
snapshots/
  sprint-N.json     # Sprint snapshot saved when a sprint is closed
CLAUDE.md           # This file
\`\`\`

## Features (GitHub Issues in this repo)

Features are tracked as issues with the \`feature\` label.
- Labels: \`status:{plan,in_progress,demo,tested,production,future}\`
- Sprints: GitHub Milestones named "Sprint N"
- Owners: issue assignees
- Tasks: sub-issues under feature issues (with \`points:{1,2,3,5,8,13}\` labels)

\`\`\`bash
gh issue list --repo {org}/unticket --label feature
gh issue view <number> --repo {org}/unticket
\`\`\`

## Todos (GitHub Issues in this repo)

Personal todos are issues with the \`todo\` label.
- Labels: \`todo\`, \`todo-status:{backlog,in_progress,done}\`, \`todo-owner:{login}\`, \`todo-feature:{number}\`
- Closing a todo marks it done; reopening moves it back

\`\`\`bash
gh issue list --repo {org}/unticket --label todo
\`\`\`

## People Config

Team member metadata at \`config/people.json\`:

\`\`\`json
[
  { "github": "login", "name": "Display Name", "teams": ["Team"], "role": "Role" }
]
\`\`\`

\`\`\`bash
# Read
gh api repos/{org}/unticket/contents/config/people.json --jq '.content' | base64 -d

# Update (get SHA first)
SHA=$(gh api repos/{org}/unticket/contents/config/people.json --jq '.sha')
cat people.json | base64 | gh api repos/{org}/unticket/contents/config/people.json \\
  -X PUT -f message="Update people" -f content=@- -f sha="$SHA"
\`\`\`

## Plans

\`\`\`bash
# List all plans
gh api repos/{org}/unticket/contents/plans/ --jq '.[].name'

# Read a plan
gh api repos/{org}/unticket/contents/plans/PLAN-42.md --jq '.content' | base64 -d
\`\`\`
`;

export async function createUnticketRepo(org: string): Promise<void> {
  const ok = getOctokit();

  await ok.rest.repos.createInOrg({
    org,
    name: REPO_NAME,
    description: "unticket.ai plans",
    private: true,
    auto_init: true,
  });

  // Small delay to let GitHub initialize the repo
  await new Promise((r) => setTimeout(r, 1000));

  // Create CLAUDE.md
  await ok.rest.repos.createOrUpdateFileContents({
    owner: org,
    repo: REPO_NAME,
    path: "CLAUDE.md",
    message: "Initialize CLAUDE.md",
    content: encodeBase64Utf8(CLAUDE_MD),
  });

  // Create empty plans directory with .gitkeep
  await ok.rest.repos.createOrUpdateFileContents({
    owner: org,
    repo: REPO_NAME,
    path: "plans/.gitkeep",
    message: "Initialize plans directory",
    content: btoa(""),
  });
}

// ---------- Plan files ----------

export function planFilePath(featureId: string): string {
  return `plans/PLAN-${featureId}.md`;
}

export async function fetchPlanFile(
  org: string,
  featureId: string,
): Promise<{ content: string } | null> {
  return fetchFileFromUnticket(org, planFilePath(featureId));
}

export async function savePlanFile(
  org: string,
  featureId: string,
  content: string,
): Promise<void> {
  await saveFileToUnticket(org, planFilePath(featureId), content, `Update plan for ${featureId}`);
}

// ---------- Todo plan files ----------

export function todoPlanFilePath(todoId: string): string {
  return `plans/TODO-${todoId}.md`;
}

export async function fetchTodoPlanFile(
  org: string,
  todoId: string,
): Promise<{ content: string } | null> {
  return fetchFileFromUnticket(org, todoPlanFilePath(todoId));
}

export async function saveTodoPlanFile(
  org: string,
  todoId: string,
  content: string,
): Promise<void> {
  await saveFileToUnticket(org, todoPlanFilePath(todoId), content, `Update plan for ${todoId}`);
}

// ---------- People config ----------

// Canonical path is config/people.json; people.json is legacy fallback for reads only
const PEOPLE_PATHS = ["config/people.json", "people.json"];

export async function fetchPeopleFromRepo(org: string): Promise<Person[]> {
  try {
    for (const path of PEOPLE_PATHS) {
      const result = await fetchFileFromUnticket(org, path);
      if (result) return JSON.parse(result.content) as Person[];
    }
    return [];
  } catch (error) {
    console.warn("[unticket.ai] Failed to fetch people.json:", error);
    return [];
  }
}

export async function savePeopleToRepo(org: string, people: Person[]): Promise<void> {
  const content = JSON.stringify(people, null, 2);
  await saveFileToUnticket(org, PEOPLE_PATHS[0], content, "Update people config");
}

// ---------- Sprint snapshots ----------

export function snapshotFilePath(sprintNumber: number): string {
  return `snapshots/sprint-${sprintNumber}.json`;
}

export async function saveSnapshotToRepo(
  org: string,
  snapshot: import("./types").SprintSnapshot,
): Promise<void> {
  const content = JSON.stringify(snapshot, null, 2);
  await saveFileToUnticket(org, snapshotFilePath(snapshot.sprintNumber), content, `Snapshot Sprint ${snapshot.sprintNumber}`);
}

export async function deleteSnapshotFromRepo(
  org: string,
  sprintNumber: number,
): Promise<void> {
  const ok = getOctokit();
  const path = snapshotFilePath(sprintNumber);
  try {
    const { data } = await ok.rest.repos.getContent({ owner: org, repo: REPO_NAME, path });
    if ("sha" in data) {
      await ok.rest.repos.deleteFile({
        owner: org,
        repo: REPO_NAME,
        path,
        message: `Remove Sprint ${sprintNumber} snapshot`,
        sha: data.sha,
      });
    }
  } catch {
    // File doesn't exist — nothing to delete
  }
}

// ---------- Base64 helpers (UTF-8 safe) ----------

function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function decodeBase64Utf8(value: string): string {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// ---------- Shared helpers ----------

async function saveFileToUnticket(
  org: string,
  path: string,
  content: string,
  message: string,
): Promise<void> {
  const ok = getOctokit();

  // Get current SHA if the file already exists
  let sha: string | undefined;
  try {
    const { data } = await ok.rest.repos.getContent({
      owner: org,
      repo: REPO_NAME,
      path,
    });
    if ("sha" in data) {
      sha = data.sha;
    }
  } catch (e: unknown) {
    if (!(e && typeof e === "object" && "status" in e && (e as { status: number }).status === 404)) {
      throw e;
    }
    // 404 means new file — no SHA needed
  }

  await ok.rest.repos.createOrUpdateFileContents({
    owner: org,
    repo: REPO_NAME,
    path,
    message,
    content: encodeBase64Utf8(content),
    ...(sha ? { sha } : {}),
  });
}

async function fetchFileFromUnticket(
  org: string,
  path: string,
): Promise<{ content: string } | null> {
  const ok = getOctokit();
  try {
    const { data } = await ok.rest.repos.getContent({
      owner: org,
      repo: REPO_NAME,
      path,
    });
    if ("content" in data && data.type === "file") {
      return { content: decodeBase64Utf8(data.content) };
    }
    return null;
  } catch (e: unknown) {
    if (e && typeof e === "object" && "status" in e && (e as { status: number }).status === 404) {
      return null;
    }
    throw e;
  }
}
