# unticket.ai

> **Internal maintainer documentation.** This file is the working reference for maintainers and AI coding agents — it references internal tooling and conventions. If you're getting started with the project, see [README.md](./README.md), [DEPLOY.md](./DEPLOY.md) (self-hosting), and [ARCHITECTURE.md](./ARCHITECTURE.md) (public architecture overview) instead.

## Rules

- **When you add, remove, or significantly change a feature, update the `## Features` section of this file to reflect the change.** This keeps every future Claude Code session (for any team member) aware of what exists.
- **When you add new architecture patterns (new API routes, new shared hooks, new config keys), update the `## Architecture` section.**
- **Code review (`/review-external`)**: Always use the review-external skill at `~/.claude/skills/review-external/SKILL.md`. This runs a two-expert review (Zhipu GLM-5 + Claude) with peer discussion on critical findings. Use it before merging PRs.
- **After merging PRs**: Always check the deploy status (`gh api repos/No-Box-Dev/unticket/actions/runs --jq '.workflow_runs[0]'`) and verify it succeeds. If the deploy fails, fix the build immediately. Also check for automated review comments (Gemini, CodeRabbit) on the merged PR and address any issues that landed on main.

## URLs

- **Live:** https://app.unticket.ai
- **Repo:** https://github.com/No-Box-Dev/unticket
- **OAuth Callback:** https://app.unticket.ai/api/auth/callback

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

### Layout System
Top horizontal nav + content layout.
- `src/components/TopNav.tsx` — Sticky top header with logo, centered nav items, CMD+K search button, rate limit dot, settings icon, user menu. Mobile: extra horizontal scroll row of nav items below the header.
- `src/pages/DashboardPage.tsx` — Renders `TopNav` + the active tab inside an `ErrorBoundary` with lazy-loaded tab modules.

### Tab System
Each tab is a `TabId` (defined in `src/lib/types.ts`). To add a new tab:
1. Add the ID to the `TabId` union in `src/lib/types.ts`
2. Create `src/components/tabs/<Name>Tab.tsx`
3. Add nav item in `src/components/TopNav.tsx` `NAV_ITEMS`
4. Render in `src/pages/DashboardPage.tsx`

### Config System (Hybrid: D1 + GitHub Issues + unticket repo)

**Features as GitHub Issues (on `{org}/unticket` repo):**
- `src/lib/github-features.ts` — CRUD via Octokit (`fetchFeatures`, `createFeature`, `updateFeature`, `deleteFeature`, `ensureFeatureLabels`)
- Hooks: `src/hooks/useConfigRepo.ts` — `useFeatures()`, `useCreateFeature()`, `useUpdateFeature()`, `useDeleteFeature()`, `useCleanDoneFeatures()` with optimistic updates
- Label scheme: feature issues carry BOTH `unticket` AND `feature` labels. `todo` is the implicit default (no status label needed); the other columns use `status:{staging,ready,production,future}`. The `unticket` label marks an issue as project-management content owned by the app; `feature` distinguishes feature-type entries from other unticket-managed items
- `ensureFeatureLabels()` runs a one-time backfill: when the `unticket` label doesn't exist yet on the repo, it adds it to every existing `feature`-labeled open issue so the convention switch is non-breaking
- Owners: Issue assignees
- Plan: Issue body (Markdown)
- Feature ID: Issue number (integer)
- "Clean done" bulk action closes all features with `status:production` (calls `deleteFeature` per issue), then they disappear from the board
- CLI: `gh issue list --repo {org}/unticket --label unticket --label feature`

**D1 config (people, settings):**
- API endpoint: `functions/api/config/[key].js` — GET/PUT with `VALID_KEYS` whitelist
- API helpers: `src/lib/config-repo.ts` — `fetch<X>()` / `save<X>()` using `apiGet`/`apiPut`
- Hooks: `src/hooks/useConfigRepo.ts` — TanStack Query hooks with optimistic updates
- To add a new config key: add to `VALID_KEYS` + `DEFAULTS` in `[key].js`, add fetch/save in `config-repo.ts`, add hooks in `useConfigRepo.ts`

**`unticket` repo (features as issues):**
- Default repo name is `unticket`; users can override via Settings (`settings.unticketRepo`)
- Resolved by `src/lib/unticket-repo-name.ts` (`getUnticketRepoName`)
- CLI access: `gh issue list --repo {org}/unticket --label unticket --label feature`

### Backend setup (TypeScript + zod)
New backend code (Pages Functions + cron) is written in **TypeScript**, not JS. D1 access uses the native binding (`context.env.DB.prepare(...).bind(...)`, `DB.batch([...])`) — the same proven pattern as `prs.js` / `issues.js`; read `.results` off each batch entry. (Drizzle was trialed and removed — its `db.batch([db.all(sql\`...\`)])` path returned no rows for our `json_each` aggregations in the D1 runtime, and nothing else used it.) External request input is validated at the boundary with `validate(schema, input)` from `functions/lib/validate.ts` (zod) — it returns a 400 `Response` on failure that the handler returns directly. Type-check the backend with `npm run typecheck:functions` (`tsconfig.functions.json`, also wired into CI). Existing hand-rolled `.js` endpoints migrate to this pattern opportunistically; **`functions/api/engineer-stats.ts`** is the reference for an aggregation read and **`functions/api/assign.ts`** for a validated write (zod).

### API Routes (Cloudflare Pages Functions)
- `functions/api/engineer-stats.ts` — Per-member open-PR / reviewing / assigned-issue counts for the Engineers tab, aggregated server-side in one `DB.batch` (replaces client-side downloading of all PRs/issues). Returns `{ openPRs, reviewing, assignedIssues }` keyed by login.
- `functions/api/config/[key].js` — D1 config CRUD (see Config System above)
- `functions/api/sync.js` — Cursor-based GitHub-to-D1 sync: GET checks staleness (MIN across all resources), POST accepts `?cursor=repoName&force=true` for one-repo-at-a-time sync
- `functions/api/sync-events.js` — Admin-only cursor-batched backfill of the `events` table. POST with no cursor returns the active repo list; subsequent POSTs with `?cursor=<repo>` run `reconcileRepoEvents` per repo (30-day lookback). 403s for non-admin callers.
- `functions/api/op-failures.js` — Admin-only GET. Lists recent rows from the `op_failures` table (errors swallowed by `waitUntil`). Capped at 100 rows per call, default 25. 403s for non-admin callers.
- `functions/api/llm-settings.js` — Admin-only GET/PUT/DELETE for per-org LLM provider override (`llm_settings` table, migration `0023_llm_settings.sql`). PUT validates with a live `complete()` probe and refuses to save when the call fails. The encrypted key is never echoed back; GET returns `keyMask: "••••"`. Backed by `functions/lib/llm-config.js resolveLlmConfig(env, orgId)` which is the single source for "which LLM endpoint should we use right now" — falls back to the default Zhipu config (`env.ZHIPU_API_KEY`) when no row, no `ENCRYPTION_KEY`, or decryption fails. The narrator resolves via this helper.
- `functions/api/webhook.js` — GitHub webhook receiver (HMAC-SHA256 verified, handles `issues`, `pull_request`, `member` events)
- `functions/api/assign.js` — POST: update issue assignees on GitHub + D1 (`{ repo, issue_number, assignees }`)
- `functions/api/issues.js`, `functions/api/prs.js`, `functions/api/repos.js`, `functions/api/members.js` — cached data endpoints
- `functions/api/auth/callback.js` — OAuth callback. Also persists the GitHub App `refresh_token` into the `oauth_tokens` table (keyed by SHA-256 of the access token).
- `functions/api/auth/exchange.js` — One-time exchange code → access token (immediately after callback redirect).
- `functions/api/auth/refresh.js` — POST `{ token }` (the expired access token). Looks up the matching `oauth_tokens` row, calls GitHub's `grant_type=refresh_token` flow, rotates both tokens, returns the new access token. Used by `apiFetch` and `fetchUser` to silently recover from 401s so users stay signed in for the refresh-token TTL (~6 months) instead of the 8-hour access-token TTL.
- `functions/_middleware.js`, `functions/api/_middleware.js` — auth middleware (webhook route bypasses auth)
- `functions/lib/github-sync.js`, `functions/lib/db.js`, `functions/lib/crypto.js` — server-side helpers

### Sync System
Batched cursor-based sync: `triggerSync()` (in `src/lib/github.ts`) calls `POST /api/sync` in a loop — first call runs `syncInit` (config migration, repos, members), subsequent calls sync one repo at a time via cursor until `done: true`. This prevents Cloudflare Function timeouts with many repos. `triggerSyncWithProgress()` wraps this with a callback for UI progress updates (used by Issues and PRs tab sync buttons). Staleness checked via `useSyncStatus()`, triggered via `useTriggerSync()` (both in `src/hooks/useGitHub.ts`).

Key server functions in `functions/lib/github-sync.js`:
- `syncInit(db, token, orgId, orgLogin)` — migrate config, sync repos + members, return repo names
- `syncRepo(db, token, orgId, orgLogin, repo, force)` — sync PRs + issues for ONE repo
- `upsertIssue(db, orgId, repo, issue, closedBy?)` / `upsertPR` / `upsertMember` / `removeMember` — single-entity upserts used by webhook handler. `upsertIssue` accepts optional `closedBy` param; uses `COALESCE` to preserve existing `closed_by` when not provided

**Live Activity events (the `events` table — feeds Engineers tab's Live activity)** has the same three-way redundancy as PRs/issues:
1. **Webhooks** — `functions/lib/events.js storeEvent()` inserts rows in real time from `pull_request`, `issues`, `pull_request_review`, `push`, `release`, `repository`, and `installation*` payloads. `slimPayload` for `issues` carries `issue.number/title/state/author` forward so downstream dedup can match by number.
2. **Cron reconcile (30 min)** — `cron/src/reconcile.js` calls `reconcileRepoEvents` per active repo with a 48h lookback. Catches webhook deliveries missed during deploys or provider outages.
3. **Manual admin backfill** — `POST /api/sync-events` triggered from Settings → Live Activity Backfill. Same `reconcileRepoEvents` helper with a 30-day lookback.

`reconcileRepoEvents` (in `functions/lib/event-reconcile.js`) is the single source of truth for "what's missing in events for this repo." Three sources, in order: (1) `pull_requests` → `github:pr:opened|closed|merged`, (2) `issues` → `github:issue:opened|closed`, (3) `GET /repos/{owner}/{repo}/events` → reviews/pushes/releases (events GitHub doesn't expose as webhooks-into-D1). Idempotent via deterministic `delivery_id` of `reconcile:<org>:<repo>:pr-<n>:<kind>` / `issue-<n>:<kind>` / `gh-event-<id>` + the `events.delivery_id UNIQUE` constraint. Inserted rows are passed to `narrateEvent`, which only narrates types in `NARRATABLE_TYPES` (currently `github:pr:merged`) so backfilling opens/reviews/pushes doesn't trigger LLM spend.

### Webhooks
Real-time updates via GitHub org webhooks. Endpoint: `POST /api/webhook`. Verified with `GITHUB_WEBHOOK_SECRET` env var (HMAC-SHA256). Handles `issues`, `pull_request`, `member` events. On `issues.closed`, captures `sender.login` as `closed_by`. Setup instructions shown in Settings UI. Requires manual webhook creation in GitHub org settings (no `admin:org_hook` scope needed).

### Durable background work (Queues)
Slow webhook follow-up work (narration, install bootstrap, repo backfill) runs on the **`unticket-tasks`** Cloudflare Queue instead of `context.waitUntil` (which has no retry and is lost on failure). `functions/api/webhook.js` is the **producer** (`TASK_QUEUE` binding) via `enqueueTask` in `functions/lib/tasks.js` — message contract in `TASK`. The **consumer** is the cron Worker's `queue()` handler (`cron/src/index.js`), which dispatches by type to the same helpers, with retries + a dead-letter queue (`unticket-tasks-dlq`); terminal failures (after `MAX_DELIVERIES`) are recorded to `op_failures`. `enqueueTask` never throws into the webhook — a missing binding or send error is recorded to `op_failures` so the response still returns 200. **Provisioning:** `wrangler queues create unticket-tasks` + `unticket-tasks-dlq` before deploy; consumer needs `ZHIPU_API_KEY`/`ENCRYPTION_KEY` (narrate) in addition to the GitHub App secrets.

### Event retention (R2 archival)
The `events` table is bounded by a daily sweep in the cron Worker (`cron/src/archive-events.js`, gated to the 03:00 UTC ticks). Rows older than `RETENTION_DAYS` (90) are written to the **`EVENTS_ARCHIVE`** R2 bucket as date-partitioned NDJSON, then deleted from D1 in capped batches (archive-then-delete; idempotent). Manual trigger: `GET /__archive-events` on the cron Worker — gated behind `CRON_TOKEN` (send `X-Cron-Token`), and the Worker runs with `workers_dev = false` so it has no public URL by default. **Provisioning:** `wrangler r2 bucket create unticket-events-archive` before deploy.

### GitHub Data Hooks (`src/hooks/useGitHub.ts`)
TanStack Query hooks for live GitHub data: `useOrgs`, `useRepos`, `useOpenPRs`, `useOpenIssues`, `useMilestones`, `useClosedIssues`, `useMergedPRs`, `useAllPRs`, `useAllIssues`, `useOrgMembers`, `useSyncStatus`, `useTriggerSync`, `usePaginatedIssues`, `useIssueLabels`, `useUpdateIssueAssignees`.

### Shared UI Components
- `src/components/ui/SearchableSelect.tsx` — Reusable portal-based searchable single-select dropdown. Props: `value`, `onChange`, `options: {value, label}[]`, `placeholder`, `className`. Includes ARIA attributes, keyboard navigation (Escape/Arrow/Enter), auto-flip positioning, scroll/resize repositioning. Used for repo dropdowns in Issues and PRs tabs.
- `src/components/Toaster.tsx` — The single site-wide error surface, rendered once per top-level branch in `App.tsx`. Listens on the `ut:error` window event and renders stacked, auto-dismissing (8s) toast cards bottom-right with a status badge + dismiss button (caps the stack at 4, dedupes identical message+status). `toast-in` keyframes live in `src/index.css`.

### Error Surfacing (the `ut:error` bus)
All API failures must reach the user. `broadcastError(message, status?)` in `src/lib/api.ts` dispatches a `ut:error` CustomEvent that `Toaster` consumes. Every write goes through the shared `apiGet/apiPut/apiPost/apiPatch/apiDelete` helpers — `handleResponse` broadcasts on every non-OK response, so any code path using these helpers surfaces errors automatically. `src/lib/github.ts` (Octokit path) calls `broadcastError` directly. **Do not bypass the helpers with raw `apiFetch`/`fetch` for mutations** — that re-creates the silent-failure gap. The deliberate exceptions are login errors (routed to the full-screen `authError` UI in `App.tsx`, not a toast) and `BoardStagesSection` (renders 409 stage-orphan details inline because a toast can't show the "move them first" list).

### Auth
- `useAuth()` returns `user` (with `login`, `avatar_url`, `name`), `selectedOrg`, `isLoading`, `authMode` (`"oauth" | "pat"`), `loginWithToken()`, `loginWithOAuth()`, `logout()`, `setSelectedOrg()`
- Two auth modes: OAuth (production) and PAT (`loginWithToken()`)
- Dev mode: `VITE_DEV_TOKEN` / `VITE_DEV_ORG` env vars for local development
- Per-user features filter by `user.login`
- **Refresh-token rotation:** GitHub App user-to-server access tokens expire after 8 hours. The callback persists the `refresh_token` server-side in `oauth_tokens` (encrypted, keyed by SHA-256 of the access token). `src/lib/api.ts apiFetch` and `src/lib/github.ts fetchUser` intercept 401s by POSTing the expired token to `/api/auth/refresh`, which uses the stored refresh token to obtain a new pair and updates `localStorage.ut_token`. Concurrent 401s coalesce on a single in-flight refresh promise. If refresh fails (refresh-token expired or revoked) the row is deleted and the existing force-logout path runs. The refresh token rotates on every call — old tokens are invalid as soon as a new pair is issued.

## Features

### Active Tabs (visible in tab bar)

#### Features (`sprint` tab)
Flat features kanban backed by GitHub Issues (label: `feature`). Four columns: To do / Testing on staging / Ready for production / On production. Drag-and-drop status changes, search/filter by person, sort by title. Features in `status:future` are hidden from the board (the "backlog"). Features have owners and a Markdown plan in the issue body. Detail modal shows the plan and a status selector (todo / staging / ready / production / future). Header has a Sync button and an admin-only **Clean Done** button that closes every feature in `status:production` (`useCleanDoneFeatures`), removing them from the board.

#### Issues (`issues` tab)
Issues dashboard. Top section: four stat cards (open, unassigned, stale >30d, closed in last 30d). Middle section: horizontal bar chart of open issues by repo, label distribution breakdown, and closed-per-week trend chart. Bottom section: full paginated table of open + closed issues (closed within the last 30 days). Stats powered by `meta=stats` endpoint on `/api/issues` (single D1 batch query). Filters: repo (searchable), assignee, assignment status, label. Sortable columns (issue #, title, repo, age). Pagination controls per section (open / closed). Uses `usePaginatedIssues` + `useIssueStats` hooks backed by `/api/issues` with D1 pagination. Sync button with progress modal (`triggerSyncWithProgress`). Interactive assignee column using `AssignDropdown` — click to assign/unassign org members, syncs to GitHub via `POST /api/assign` with optimistic UI updates.

#### PRs (`prs` tab)
Open + merged PR view with toggle. Filters: author, repo (searchable). Sortable columns (repo, title, author, reviewers, age). Stale PR highlighting (>7 days). Sync button with progress modal (`triggerSyncWithProgress`).

### Other Features

#### Settings (`settings` tab, top-nav settings icon)
Manages people config and tracked repos (mark repos as draft). Includes webhook setup section with payload URL and link to GitHub org webhook settings. Accessed via the gear icon in the top nav. Agent Rules section lets users define org-wide rules and push them to each repo's `CLAUDE.md` via the GitHub API. Rules are stored in D1 (`agentRules` config key). Pushed content uses `<!-- unticket:start -->` / `<!-- unticket:end -->` markers for safe updates. Includes a built-in preamble explaining features, PR linking convention, and feature lifecycle. Full Re-sync button to backfill historical data with `force=true` (bypasses incremental sync timestamps). Data Sync section shows live progress during re-sync.

**Live Activity Backfill (admin-only)** — section gated by `useIsAdmin()`. Re-derives missing PR / issue / review / release / push event rows by calling `POST /api/sync-events` repo by repo (`triggerEventsBackfillWithProgress` in `src/lib/github.ts`). 30-day lookback so admins can recover events that pre-date the cron's 48h window. Used when Engineers tab's Live activity is missing recent activity for a teammate (typical cause: a deploy gap or webhook outage). Idempotent — re-running over the same period inserts zero new rows.

**AI Provider (admin-only — BYOK)** — `LlmSettingsSection` in `SettingsTab.tsx`. Lets an org admin swap the default Zhipu key for their own LLM endpoint. Two provider shapes: `anthropic` (Anthropic Messages API; also covers Zhipu's Anthropic-compat endpoint) and `openai-compatible` (OpenAI chat-completions; covers OpenAI, LiteLLM proxies, Ollama, vLLM, etc. — chosen via base URL + model name rather than a vendor-specific SDK so we don't ship a `litellm` dependency). Save triggers a live one-shot `complete()` probe and refuses to save on failure (catches bad key, wrong model name, wrong base URL before they hit production). The plaintext key is encrypted with `encryptToken` before storage, never sent back to the browser, and never logged — `op_failures` rows from a failed narrator call only carry `llmConfig.source / provider / model`, not the key.

**Background failures (admin-only)** — `RecentFailuresSection` in `SettingsTab.tsx`, gated by `useIsAdmin()`. Surfaces rows from the `op_failures` D1 table (migration `0021_op_failures.sql`). Background work scheduled via `context.waitUntil(...)` (narrator, install bootstrap, sync-on-repo-add, posts backfill) finishes after the HTTP response — when it throws, only `console.error` sees it and the response was already `200`. The `recordFailure` helper in `functions/lib/op-failures.js` writes a row into D1 from every `waitUntil` catch handler so the admin UI can show "the webhook returned 200, but the follow-up work failed: here's why." The helper swallows its own errors so logging can never escape into the response path.
