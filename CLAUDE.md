# GitPulse

## Rules

- **When you add, remove, or significantly change a feature, update the `## Features` section of this file to reflect the change.** This keeps every future Claude Code session (for any team member) aware of what exists.
- **When you add new architecture patterns (new API routes, new shared hooks, new config keys), update the `## Architecture` section.**
## URLs

- **Live:** https://gitpulse-rm8.pages.dev
- **Repo:** https://github.com/JasperNoBoxDev/gitpulse
- **OAuth Callback:** https://gitpulse-rm8.pages.dev/api/auth/callback

## OAuth

- GitHub OAuth App client ID: `Ov23liAZX2luDU7ofG2S`
- Secrets configured on Cloudflare Pages: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
- OAuth callback handled by Cloudflare Pages Function at `functions/api/auth/callback.js`

## Stack

- React 19, TypeScript, Vite
- Tailwind CSS, Lucide icons
- TanStack Query, Octokit
- Cloudflare Pages (hosting + functions)

## Architecture

### Tab System
Each tab is a `TabId` (defined in `src/lib/types.ts`). To add a new tab:
1. Add the ID to the `TabId` union in `src/lib/types.ts`
2. Create `src/components/tabs/<Name>Tab.tsx`
3. Add entry in `src/components/TabBar.tsx`
4. Render in `src/pages/DashboardPage.tsx`

### Config System (Hybrid: D1 + .gitpulse)
Org config (sprint, features, people, settings, todos) stored in **Cloudflare D1** via `functions/api/config/[key].js`. Implementation plans stored in **`{org}/.gitpulse`** GitHub repo as markdown files.

**D1 config (fast, no rate limits):**
- API endpoint: `functions/api/config/[key].js` — GET/PUT with `VALID_KEYS` whitelist
- API helpers: `src/lib/config-repo.ts` — `fetch<X>()` / `save<X>()` using `apiGet`/`apiPut`
- Hooks: `src/hooks/useConfigRepo.ts` — TanStack Query hooks with optimistic updates
- To add a new config key: add to `VALID_KEYS` + `DEFAULTS` in `[key].js`, add fetch/save in `config-repo.ts`, add hooks in `useConfigRepo.ts`

**`.gitpulse` repo (plans only, readable by Claude Code via `gh api`):**
- `src/lib/gitpulse-repo.ts` — `ensureGitPulseRepo()`, `createGitPulseRepo()`, `fetchPlanFile()`, `planFilePath()`
- Plan filenames use the feature's stable `id` (e.g. `plans/PLAN-feat-1739482930123.md`) — renaming features won't break the link
- Repo structure: `CLAUDE.md`, `plans/PLAN-{featureId}.md`
- CLI access: `gh api repos/{org}/.gitpulse/contents/plans/ --jq '.[].name'`

### Auth
- `useAuth()` provides `user` (with `login`, `avatar_url`, `name`) and `selectedOrg`
- Per-user features filter by `user.login`

## Features

### Sprint Board (`sprint` tab)
Sprint config + feature cards. Features have owners, effort, priority, status. Drag-and-drop between sprints.

### Backlog (`backlog` tab)
Future features not yet assigned to a sprint.

### Team Dashboard (`team` tab)
Aggregated metrics per team — PRs, issues, activity across repos.

### Individual Dashboard (`individual` tab)
Per-person metrics and activity.

### Open PRs (`prs` tab)
Live view of open pull requests across all org repos.

### Open Issues (`issues` tab)
Live view of open/closed issues with filtering by team, repo, label.

### Activity (`activity` tab)
Recent activity feed across repos.

### Todos (`todos` tab)
Per-user personal todo list. Each user only sees their own todos (filtered by `user.login`). Stored in the shared config key `"todos"` as an array of `Todo` objects. Supports add, toggle done, delete. Done items sort to bottom with faded styling.
