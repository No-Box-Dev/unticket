# Architecture

A high-level map of how unticket fits together. For maintainer-level detail (every API route, config key, and convention), see [CLAUDE.md](./CLAUDE.md).

## Overview

```
┌─────────────┐     ┌──────────────────────┐     ┌──────────────┐
│  React SPA  │────▶│ Cloudflare Pages      │────▶│ Cloudflare   │
│  (Vite)     │     │ Functions (API)       │     │ D1 (SQLite)  │
└─────────────┘     └──────────┬───────────┘     └──────▲───────┘
                               │ enqueue                │
                    ┌──────────▼───────────┐            │
   GitHub ─webhook─▶│  Queue (unticket-    │            │
   GitHub ◀──sync───│  tasks) + cron Worker│────────────┘
                    └──────────┬───────────┘
                               │ archive
                    ┌──────────▼───────────┐
                    │  R2 (events archive) │
                    └──────────────────────┘
```

- **Frontend** — React 19 + TypeScript + Vite SPA. TanStack Query for server state, Octokit for direct GitHub calls, Tailwind for styling. A top-nav layout with lazy-loaded tabs (Features, Issues, PRs, Engineers, Settings).
- **API** — Cloudflare Pages Functions under `functions/api/`. New code is TypeScript with zod validation at the boundary; data access uses the native D1 binding (`DB.prepare().bind()`, `DB.batch()`).
- **Database** — Cloudflare D1 (SQLite). Schema in `migrations/`, applied with `wrangler d1 migrations apply`.
- **Cron Worker** — a sibling Worker in `cron/` that imports shared helpers from `functions/lib/`. It reconciles GitHub state every 30 minutes and consumes the background-work queue.
- **Queue + R2** — durable background work (narration, bootstrap, repo sync) runs on a Cloudflare Queue with retries and a dead-letter queue; the `events` table is archived to R2 after 90 days.

## Multi-tenancy

Unticket is multi-tenant. Each GitHub organisation is an `org` row, and core tables (`repos`, `pull_requests`, `issues`, `members`, `config`, `features`, `teams`, `llm_settings`) carry an `org_id` foreign key. The auth middleware (`functions/_middleware.js`) resolves the caller's org from the request, verifies GitHub membership, and scopes every query by `org_id`. The first user to authenticate for an org becomes its admin.

## Auth

Two modes:

- **GitHub App + OAuth** — "Sign in with GitHub". Access tokens are short-lived; refresh tokens are stored encrypted server-side and rotated on 401 (`functions/api/auth/refresh.ts`). Webhooks deliver real-time updates.
- **Personal Access Token** — zero backend setup, but read-only: no webhooks, so data is only as fresh as the last manual sync.

## Data freshness: three redundant paths

GitHub data stays current via three mechanisms, in priority order:

1. **Webhooks** (`functions/api/webhook.js`) — real-time, HMAC-verified. The running source of truth.
2. **Cron reconcile** (every 30 min) — catches deletes (GitHub fires no delete webhooks), deliveries missed during deploys, and label changes on pre-install issues.
3. **Manual sync / backfill** — admin-triggered from the UI for first sync or recovery. Rate-limited to bound cost.

## Background work

Slow webhook follow-up (LLM narration, install bootstrap, repo backfill) is enqueued to the `unticket-tasks` Queue rather than run inline. The cron Worker's `queue()` handler dispatches by task type with retries; terminal failures are recorded to the `op_failures` table and surfaced to admins in Settings.

## AI narration

A bounded LLM integration narrates pull-request merges. It's paced, disable-able per project, and supports per-org Bring-Your-Own-Key (Anthropic-compatible or OpenAI-compatible providers). The default backend is Zhipu's GLM endpoint. Keys are encrypted at rest and never returned to the browser.

## Where to look

| Concern | Path |
|---|---|
| Tabs / pages | `src/pages/`, `src/components/tabs/` |
| GitHub data hooks | `src/hooks/useGitHub.ts` |
| API routes | `functions/api/` |
| Shared server helpers | `functions/lib/` |
| DB schema | `migrations/` |
| Cron + queue consumer | `cron/src/` |
