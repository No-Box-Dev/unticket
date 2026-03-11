import { getOctokit } from "./github";

const START_MARKER = "<!-- gitpulse:start -->";
const END_MARKER = "<!-- gitpulse:end -->";
const FILE_PATH = "CLAUDE.md";

function buildPreamble(org: string): string {
  return `This organisation uses [unticket.ai](https://app.unticket.ai) for project management.

### Features & Sprints
- **Features** are tracked as GitHub Issues on a separate repo: [\`${org}/.gitpulse\`](https://github.com/${org}/.gitpulse) (not this repo)
- Each feature issue has labels for status (\`status:plan\`, \`status:demo\`, \`status:production\`), effort, and priority
- Owners are the issue's assignees. Sprints are GitHub Milestones named "Sprint N"
- Feature plans live in the issue body as Markdown. Tasks are GitHub sub-issues linked to the parent feature issue
- List features: \`gh issue list --repo ${org}/.gitpulse --label feature\`
- View a feature: \`gh issue view <number> --repo ${org}/.gitpulse\`

### PRs & Feature Linking
- When creating PRs in this repo, reference the related feature: \`Part of ${org}/.gitpulse#<number>\`
- **Do not** use "Closes", "Fixes", or "Resolves" when referencing \`${org}/.gitpulse\` issues — a feature may require multiple PRs across repos. Closing keywords would prematurely close the feature
- It is fine to use "Closes #N" for issues that live in this repo (bugs, tasks, etc.)

### Feature Lifecycle
- When working on a feature, update its plan and check off tasks on the \`${org}/.gitpulse\` issue
- When a feature has a working demo, update its status label to \`status:demo\` (remove \`status:plan\`, add \`status:demo\`)
- When a feature is fully complete and in production, update to \`status:production\`
- To update status via CLI: \`gh issue edit <number> --repo ${org}/.gitpulse --remove-label status:plan --add-label status:demo\`

### Todos
- Personal todos are GitHub Issues in \`${org}/.gitpulse\` with the \`todo\` label
- Labels: \`todo-status:{backlog,in_progress,done}\`, \`todo-owner:{login}\`, \`todo-feature:{number}\`, \`todo-repo:{name}\`
- Closing a todo issue marks it as done; reopening moves it back
- List todos: \`gh issue list --repo ${org}/.gitpulse --label todo\`

### People Config
- Team member info (name, role, teams) is stored at \`${org}/.gitpulse/config/people.json\`
- Format: \`[{ "github": "login", "name": "Display Name", "teams": ["Team"], "role": "Role" }]\`
- Edit directly on GitHub or via CLI: \`gh api repos/${org}/.gitpulse/contents/config/people.json --jq '.content' | base64 -d\``;
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
        content: btoa(unescape(encodeURIComponent(newContent))),
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
