import { getOctokit } from "./github";

const START_MARKER = "<!-- gitpulse:start -->";
const END_MARKER = "<!-- gitpulse:end -->";
const FILE_PATH = "CLAUDE.md";

function buildPreamble(org: string): string {
  return `This organisation uses [unticket.ai](https://app.unticket.ai) for project management.

### Features & Sprints
- **Features** are tracked as GitHub Issues on a separate repo: [\`${org}/gitpulse\`](https://github.com/${org}/gitpulse) (not this repo)
- Each feature issue has labels for status (\`status:plan\`, \`status:in_progress\`, \`status:demo\`, \`status:tested\`, \`status:production\`)
- Owners are the issue's assignees. Sprints are GitHub Milestones named "Sprint N"
- Feature plans live in the issue body as Markdown. Tasks are GitHub sub-issues linked to the parent feature issue
- List features: \`gh issue list --repo ${org}/gitpulse --label feature\`
- View a feature: \`gh issue view <number> --repo ${org}/gitpulse\`

### PRs & Feature Linking
- When creating PRs in this repo, reference the related feature: \`Part of ${org}/gitpulse#<number>\`
- **Do not** use "Closes", "Fixes", or "Resolves" when referencing \`${org}/gitpulse\` issues — a feature may require multiple PRs across repos. Closing keywords would prematurely close the feature
- It is fine to use "Closes #N" for issues that live in this repo (bugs, tasks, etc.)

### Feature Lifecycle
- When working on a feature, update its plan and check off tasks on the \`${org}/gitpulse\` issue
- Feature lifecycle: Plan → In Progress → Demo → Tested → In Production
- To advance status via CLI: \`gh issue edit <number> --repo ${org}/gitpulse --remove-label status:plan --add-label status:in_progress\`

### Todos
- Personal todos are GitHub Issues in \`${org}/gitpulse\` with the \`todo\` label
- Labels: \`todo\`, \`todo-status:{backlog,in_progress,done}\`, \`todo-owner:{login}\`, \`todo-feature:{number}\`
- Closing a todo issue marks it as done; reopening moves it back
- List todos: \`gh issue list --repo ${org}/gitpulse --label todo\`

### People Config
- Team member info (name, role, team) is stored at \`${org}/gitpulse/people.json\`
- Format: \`[{ "github": "login", "name": "Display Name", "role": "Role", "team": "Team" }]\`
- Edit directly on GitHub or via CLI: \`gh api repos/${org}/gitpulse/contents/people.json --jq '.content' | base64 -d\``;
}

function buildSection(org: string, rules: string[]): string {
  const lines = [
    START_MARKER,
    `## unticket.ai (${org})`,
    "",
    buildPreamble(org),
  ];
  if (rules.length > 0) {
    lines.push("", "### Org Rules", "");
    lines.push(...rules.map((r) => r.trim()));
  }
  lines.push("", END_MARKER);
  return lines.join("\n");
}

function injectSection(existing: string, section: string): string {
  const startIdx = existing.indexOf(START_MARKER);
  const endIdx = existing.indexOf(END_MARKER);

  if (startIdx !== -1 && endIdx !== -1) {
    // Replace existing section
    const before = existing.slice(0, startIdx).trimEnd();
    const after = existing.slice(endIdx + END_MARKER.length).trimStart();
    const parts = [before, "", section];
    if (after) parts.push("", after);
    return parts.join("\n") + "\n";
  }

  // Append
  return existing.trimEnd() + "\n\n" + section + "\n";
}

export function buildClaudeMdPreview(org: string, rules: string[]): string {
  return buildSection(org, rules);
}

export async function fetchClaudeMdContent(
  org: string,
  repo: string,
): Promise<{ content: string; sha: string } | null> {
  const ok = getOctokit();
  try {
    const { data } = await ok.rest.repos.getContent({
      owner: org,
      repo,
      path: FILE_PATH,
    });
    if ("content" in data && data.type === "file") {
      return {
        content: atob(data.content.replace(/\n/g, "")),
        sha: data.sha,
      };
    }
    return null;
  } catch (err: any) {
    if (err.status === 404) return null;
    throw err;
  }
}

export function extractManagedSection(content: string): string | null {
  const startIdx = content.indexOf(START_MARKER);
  const endIdx = content.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1) return null;
  return content.slice(startIdx, endIdx + END_MARKER.length);
}

interface OutdatedCheckResult {
  outdated: string[];
  upToDate: string[];
  noFile: string[];
  errors: string[];
}

export async function checkOutdatedRepos(
  org: string,
  repoNames: string[],
  rules: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<OutdatedCheckResult> {
  const expected = buildSection(org, rules);
  const result: OutdatedCheckResult = { outdated: [], upToDate: [], noFile: [], errors: [] };

  for (let i = 0; i < repoNames.length; i++) {
    const repo = repoNames[i];
    try {
      const file = await fetchClaudeMdContent(org, repo);
      if (!file) {
        result.noFile.push(repo);
      } else {
        const managed = extractManagedSection(file.content);
        if (!managed || managed.trim() !== expected.trim()) {
          result.outdated.push(repo);
        } else {
          result.upToDate.push(repo);
        }
      }
    } catch (err: any) {
      result.errors.push(`${repo}: ${err.message ?? "Unknown error"}`);
    }
    onProgress?.(i + 1, repoNames.length);
  }

  return result;
}

interface SyncResult {
  updated: number;
  skipped: number;
  errors: string[];
  updatedRepos: string[];
}

export async function pushClaudeMdToRepos(
  org: string,
  repoNames: string[],
  rules: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<SyncResult> {
  const ok = getOctokit();
  const section = buildSection(org, rules);
  const result: SyncResult = { updated: 0, skipped: 0, errors: [], updatedRepos: [] };

  for (let i = 0; i < repoNames.length; i++) {
    const repo = repoNames[i];
    try {
      // Try to read existing CLAUDE.md
      let existingContent = "";
      let sha: string | undefined;

      try {
        const { data } = await ok.rest.repos.getContent({
          owner: org,
          repo,
          path: FILE_PATH,
        });
        if ("content" in data && data.type === "file") {
          existingContent = atob(data.content.replace(/\n/g, ""));
          sha = data.sha;
        }
      } catch (err: any) {
        if (err.status !== 404) throw err;
        // File doesn't exist — will create
      }

      const newContent = existingContent
        ? injectSection(existingContent, section)
        : section + "\n";

      // Skip if content unchanged
      if (existingContent && newContent.trim() === existingContent.trim()) {
        result.skipped++;
        onProgress?.(i + 1, repoNames.length);
        continue;
      }

      await ok.rest.repos.createOrUpdateFileContents({
        owner: org,
        repo,
        path: FILE_PATH,
        message: "Update CLAUDE.md with unticket.ai agent rules",
        content: btoa(String.fromCodePoint(...new TextEncoder().encode(newContent))),
        ...(sha ? { sha } : {}),
      });

      result.updated++;
      result.updatedRepos.push(repo);
    } catch (err: any) {
      result.errors.push(`${repo}: ${err.message ?? "Unknown error"}`);
    }
    onProgress?.(i + 1, repoNames.length);
  }

  return result;
}
