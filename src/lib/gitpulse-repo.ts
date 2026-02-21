import { getOctokit } from "./github";

const REPO_NAME = ".gitpulse";

// ---------- Repo management ----------

export async function ensureGitPulseRepo(org: string): Promise<boolean> {
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

const CLAUDE_MD = `# .gitpulse

Plans repository for GitPulse. Contains implementation plans for features and todos.

Config (sprint, features, people, settings, todos) is stored in D1 — not here.

## Structure

\`\`\`
plans/
  PLAN-*.md   # Implementation plans per feature (e.g. PLAN-feat-1739482930123.md)
  TODO-*.md   # Implementation plans per todo (e.g. TODO-a1b2c3d4-uuid.md)
CLAUDE.md     # This file
\`\`\`

## Reading plans via CLI

\`\`\`bash
# List all plans
gh api repos/{org}/.gitpulse/contents/plans/ --jq '.[].name'

# Read a specific plan (feature ID is visible in the GitPulse modal hint text)
gh api repos/{org}/.gitpulse/contents/plans/PLAN-feat-1739482930123.md --jq '.content' | base64 -d
\`\`\`

## Writing plans via CLI

\`\`\`bash
# Create a new plan (use the feature ID from the GitPulse modal)
echo '# Plan' | base64 | gh api repos/{org}/.gitpulse/contents/plans/PLAN-feat-1739482930123.md \\
  -X PUT -f message="Add plan" -f content=@-

# Update existing plan (get SHA first)
SHA=$(gh api repos/{org}/.gitpulse/contents/plans/PLAN-feat-1739482930123.md --jq '.sha')
echo '# Updated plan' | base64 | gh api repos/{org}/.gitpulse/contents/plans/PLAN-feat-1739482930123.md \\
  -X PUT -f message="Update plan" -f content=@- -f sha="$SHA"
\`\`\`
`;

export async function createGitPulseRepo(org: string): Promise<void> {
  const ok = getOctokit();

  await ok.rest.repos.createInOrg({
    org,
    name: REPO_NAME,
    description: "GitPulse plans",
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
    content: btoa(unescape(encodeURIComponent(CLAUDE_MD))),
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
  return fetchFileFromGitPulse(org, planFilePath(featureId));
}

// ---------- Todo plan files ----------

export function todoPlanFilePath(todoId: string): string {
  return `plans/TODO-${todoId}.md`;
}

export async function fetchTodoPlanFile(
  org: string,
  todoId: string,
): Promise<{ content: string } | null> {
  return fetchFileFromGitPulse(org, todoPlanFilePath(todoId));
}

// ---------- Shared helpers ----------

async function fetchFileFromGitPulse(
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
      return { content: atob(data.content) };
    }
    return null;
  } catch (e: unknown) {
    if (e && typeof e === "object" && "status" in e && (e as { status: number }).status === 404) {
      return null;
    }
    throw e;
  }
}
