# GitPulse

## Rules

- **When you add, remove, or significantly change a feature, update the `## Features` section of this file to reflect the change.** This keeps every future Claude Code session (for any team member) aware of what exists.
- **When you add new architecture patterns (new API routes, new shared hooks, new config keys), update the `## Architecture` section.**
## URLs

- **Live:** https://gitpulse-rm8.pages.dev
- **Repo:** https://github.com/No-Box-Dev/gitpulse
- **OAuth Callback:** https://gitpulse-rm8.pages.dev/api/auth/callback

## OAuth

- GitHub OAuth App client ID: `Ov23liAZX2luDU7ofG2S`
- Secrets configured on Cloudflare Pages: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
- OAuth callback handled by Cloudflare Pages Function at `functions/api/auth/callback.js`

## Stack

- React 19, TypeScript, Vite
- Tailwind CSS, Lucide icons, Radix UI primitives
- TanStack Query, Octokit, Zustand (state), React Router
- Cloudflare Pages (hosting + functions + D1)
- Testing: Vitest, Testing Library

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
- `src/lib/gitpulse-repo.ts` — `ensureGitPulseRepo()`, `createGitPulseRepo()`, `fetchPlanFile()`, `planFilePath()`, `fetchTodoPlanFile()`, `todoPlanFilePath()`
- Feature plans: `plans/PLAN-{featureId}.md` (e.g. `PLAN-feat-1739482930123.md`)
- Todo plans: `plans/TODO-{todoId}.md` (e.g. `TODO-a1b2c3d4-uuid.md`)
- Repo structure: `CLAUDE.md`, `plans/PLAN-*.md`, `plans/TODO-*.md`
- CLI access: `gh api repos/{org}/.gitpulse/contents/plans/ --jq '.[].name'`

### API Routes (Cloudflare Pages Functions)
- `functions/api/config/[key].js` — D1 config CRUD (see Config System above)
- `functions/api/sync.js` — Cursor-based GitHub-to-D1 sync: GET checks staleness (MIN across all resources), POST accepts `?cursor=repoName&force=true` for one-repo-at-a-time sync
- `functions/api/webhook.js` — GitHub webhook receiver (HMAC-SHA256 verified, handles `issues`, `pull_request`, `member` events)
- `functions/api/assign.js` — POST: update issue assignees on GitHub + D1 (`{ repo, issue_number, assignees }`)
- `functions/api/issues.js`, `functions/api/prs.js`, `functions/api/repos.js`, `functions/api/members.js` — cached data endpoints
- `functions/api/auth/callback.js` — OAuth callback
- `functions/_middleware.js`, `functions/api/_middleware.js` — auth middleware (webhook route bypasses auth)
- `functions/lib/github-sync.js`, `functions/lib/db.js`, `functions/lib/crypto.js` — server-side helpers

### Sync System
Batched cursor-based sync: `triggerSync()` (in `src/lib/github.ts`) calls `POST /api/sync` in a loop — first call runs `syncInit` (config migration, repos, members), subsequent calls sync one repo at a time via cursor until `done: true`. This prevents Cloudflare Function timeouts with many repos. `triggerSyncWithProgress()` wraps this with a callback for UI progress updates (used by Issues and PRs tab sync buttons). Staleness checked via `useSyncStatus()`, triggered via `useTriggerSync()` (both in `src/hooks/useGitHub.ts`).

Key server functions in `functions/lib/github-sync.js`:
- `syncInit(db, token, orgId, orgLogin)` — migrate config, sync repos + members, return repo names
- `syncRepo(db, token, orgId, orgLogin, repo, force)` — sync PRs + issues for ONE repo
- `upsertIssue/upsertPR/upsertMember/removeMember` — single-entity upserts used by webhook handler

### Webhooks
Real-time updates via GitHub org webhooks. Endpoint: `POST /api/webhook`. Verified with `GITHUB_WEBHOOK_SECRET` env var (HMAC-SHA256). Handles `issues`, `pull_request`, `member` events. Setup instructions shown in Settings UI. Requires manual webhook creation in GitHub org settings (no `admin:org_hook` scope needed).

### GitHub Data Hooks (`src/hooks/useGitHub.ts`)
TanStack Query hooks for live GitHub data: `useOrgs`, `useRepos`, `useOpenPRs`, `useOpenIssues`, `useMilestones`, `useActivity`, `useClosedIssues`, `useMergedPRs`, `useAllPRs`, `useAllIssues`, `useOrgMembers`, `useSyncStatus`, `useTriggerSync`, `usePaginatedIssues`, `useIssueLabels`, `useUpdateIssueAssignees`.

### Shared UI Components
- `src/components/ui/SearchableSelect.tsx` — Reusable portal-based searchable single-select dropdown. Props: `value`, `onChange`, `options: {value, label}[]`, `placeholder`, `className`. Includes ARIA attributes, keyboard navigation (Escape/Arrow/Enter), auto-flip positioning, scroll/resize repositioning. Used for repo dropdowns in Issues, PRs, and Todos tabs.

### Auth
- `useAuth()` returns `user` (with `login`, `avatar_url`, `name`), `selectedOrg`, `isLoading`, `authMode` (`"oauth" | "pat"`), `loginWithToken()`, `loginWithOAuth()`, `logout()`, `setSelectedOrg()`
- Two auth modes: OAuth (production) and PAT (`loginWithToken()`)
- Dev mode: `VITE_DEV_TOKEN` / `VITE_DEV_ORG` env vars for local development
- Per-user features filter by `user.login`

## Features

### Active Tabs (visible in tab bar)

#### Sprint Board (`sprint` tab)
Sprint config + feature cards. Features have owners, effort, priority, status. Drag-and-drop between sprints.

#### Backlog (`backlog` tab)
Future features not yet assigned to a sprint.

#### Issues (`issues` tab)
Server-side paginated view of open + closed issues (closed since sprint start). Filters: team, repo (searchable), label. Sortable columns (issue #, title, repo, age). Pagination controls per section (open / closed). Uses `usePaginatedIssues` hook backed by `/api/issues` with D1 pagination. Sync button with progress modal (`triggerSyncWithProgress`). Interactive assignee column using `AssignDropdown` — click to assign/unassign org members, syncs to GitHub via `POST /api/assign` with optimistic UI updates.

#### PRs (`prs` tab)
Open + merged PR view with toggle. Filters: team, author, repo (searchable). Sortable columns (repo, title, author, reviewers, age). Stale PR highlighting (>7 days). Sync button with progress modal (`triggerSyncWithProgress`).

#### Todos (`todos` tab)
Per-user kanban board with Backlog / In Progress / Done columns and drag-and-drop. Each user only sees their own todos (filtered by `user.login`). Stored in the shared config key `"todos"` as an array of `Todo` objects with `status: TodoStatus`. Todos can be linked to a feature, a repo (searchable dropdown), and an implementation plan (`plans/TODO-{id}.md` in `.gitpulse` repo). Done column has a "Clear" button. Click a card to open a detail modal with feature/repo (searchable)/status selectors and plan view.

### Disabled Tabs (commented out in TabBar.tsx, components exist)

#### Team Dashboard (`team` tab)
Aggregated metrics per team — PRs, issues, activity across repos.

#### Individual Dashboard (`individual` tab)
Per-person activity dashboard with date range selector (1m/10w/6m/1y). Shows 3 bar chart cards: PRs Created (all PRs, not just merged), Issues Closed, Issues Created. Each card shows weekly bar chart, total count, and week-over-week change.

#### Activity (`activity` tab)
Recent activity feed across repos.

### Other Features

#### Settings (header button, not a tab)
Manages teams/repos and people config. Includes webhook setup section with payload URL and link to GitHub org webhook settings. Accessed via header button, rendered in `DashboardPage.tsx` via `showSettings` state.
