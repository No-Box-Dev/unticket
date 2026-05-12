import { getOctokit } from "./github";
import { getUnticketRepoName } from "./unticket-repo-name";
import type { Person } from "./types";

// ---------- Repo management ----------

export async function ensureUnticketRepo(org: string): Promise<boolean> {
  const ok = getOctokit();
  try {
    await ok.rest.repos.get({ owner: org, repo: getUnticketRepoName() });
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
CLAUDE.md           # This file
\`\`\`

## Features (GitHub Issues in this repo)

Features are tracked as issues that carry BOTH the \`unticket\` and \`feature\` labels.
- Default column ("To Do") = no status label
- Other columns use \`status:staging\`, \`status:ready\`, \`status:production\`, or \`status:future\`
- Owners: issue assignees

\`\`\`bash
gh issue list --repo {org}/unticket --label unticket --label feature
gh issue view <number> --repo {org}/unticket
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
    name: getUnticketRepoName(),
    description: "unticket.ai plans",
    private: true,
    auto_init: true,
  });

  // Small delay to let GitHub initialize the repo
  await new Promise((r) => setTimeout(r, 1000));

  // Create CLAUDE.md
  await ok.rest.repos.createOrUpdateFileContents({
    owner: org,
    repo: getUnticketRepoName(),
    path: "CLAUDE.md",
    message: "Initialize CLAUDE.md",
    content: encodeBase64Utf8(CLAUDE_MD),
  });

  // Create empty plans directory with .gitkeep
  await ok.rest.repos.createOrUpdateFileContents({
    owner: org,
    repo: getUnticketRepoName(),
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

// ---------- People config ----------

const PEOPLE_PATH = "config/people.json";

export async function fetchPeopleFromRepo(org: string): Promise<Person[]> {
  try {
    const result = await fetchFileFromUnticket(org, PEOPLE_PATH);
    if (result) return JSON.parse(result.content) as Person[];
    return [];
  } catch (error) {
    console.warn("[unticket.ai] Failed to fetch people.json:", error);
    return [];
  }
}

export async function savePeopleToRepo(org: string, people: Person[]): Promise<void> {
  const content = JSON.stringify(people, null, 2);
  await saveFileToUnticket(org, PEOPLE_PATH, content, "Update people config");
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
      repo: getUnticketRepoName(),
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
    repo: getUnticketRepoName(),
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
      repo: getUnticketRepoName(),
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
