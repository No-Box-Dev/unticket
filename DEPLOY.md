# Self-hosting Unticket

Unticket runs on Cloudflare: a Pages project (frontend + API Functions), a D1 database, a sibling cron Worker, a Queue, and an R2 bucket. This guide walks a fresh deploy end to end.

> Unticket is open-source software under the [GNU AGPL-3.0](./LICENSE). Self-host freely; if you expose a modified version as a network service, you must share the source under the same license.

## Prerequisites

- Node.js 22+
- A Cloudflare account, with `wrangler` authenticated (`npx wrangler login`)
- A GitHub organisation you administer (to install the App on)

## 1. Clone and configure

```bash
git clone https://github.com/No-Box-Dev/unticket.git
cd unticket
npm ci
cp .env.example .env.local
```

Edit `wrangler.toml` and `cron/wrangler.toml`: replace `database_id` (and, if you like, the `*-unticket*` resource names) with your own — the committed IDs point at the canonical hosted instance and you cannot deploy to them.

## 2. Provision Cloudflare resources

```bash
# D1 database — copy the printed database_id into BOTH wrangler.toml files
npx wrangler d1 create unticket

# Durable background-work queue + its dead-letter queue
npx wrangler queues create unticket-tasks
npx wrangler queues create unticket-tasks-dlq

# R2 bucket for event-table archival
npx wrangler r2 bucket create unticket-events-archive
```

Apply migrations to the remote DB:

```bash
npx wrangler d1 migrations apply unticket --remote
```

## 3. Register a GitHub App

Create a GitHub App (Settings → Developer settings → GitHub Apps → New) with:

- **Callback URL:** `https://<your-pages-domain>/api/auth/callback`
- **Webhook URL:** `https://<your-pages-domain>/api/webhook`
- **Webhook secret:** generate a random string; you'll set it as `GITHUB_WEBHOOK_SECRET`
- **Permissions:** Repository → Contents (read), Issues (read/write), Pull requests (read), Metadata (read); Organization → Members (read)
- **Subscribe to events:** Issues, Pull request, Pull request review, Push, Release, Member
- Enable **"Request user authorization (OAuth) during installation"** and **expiring user tokens** (enables refresh-token rotation)

Note the **App ID**, **Client ID**, generate a **Client secret**, and download the **private key** (PEM).

## 4. Set secrets

Frontend build var (public) — set in `.env.local` for local builds and as a Pages env var/secret for CI:

```
VITE_GITHUB_APP_CLIENT_ID=<your app client id>
```

Server-side secrets on the **Pages** project:

```bash
npx wrangler pages secret put GITHUB_APP_ID         --project-name unticket
npx wrangler pages secret put GITHUB_APP_CLIENT_ID  --project-name unticket
npx wrangler pages secret put GITHUB_APP_CLIENT_SECRET --project-name unticket
npx wrangler pages secret put GITHUB_APP_PRIVATE_KEY --project-name unticket
npx wrangler pages secret put GITHUB_WEBHOOK_SECRET --project-name unticket
npx wrangler pages secret put ENCRYPTION_KEY        --project-name unticket   # 64-char hex
npx wrangler pages secret put ZHIPU_API_KEY         --project-name unticket
```

Generate `ENCRYPTION_KEY` with `openssl rand -hex 32`.

The **cron Worker** needs its own copy of the secrets it uses:

```bash
npx wrangler secret put GITHUB_APP_ID        --name unticket-cron
npx wrangler secret put GITHUB_APP_PRIVATE_KEY --name unticket-cron
npx wrangler secret put ZHIPU_API_KEY        --name unticket-cron
npx wrangler secret put ENCRYPTION_KEY       --name unticket-cron
```

> **LLM provider:** `ZHIPU_API_KEY` is the default narrator backend (Zhipu's Anthropic-compatible GLM endpoint). Each org can override it with their own key (BYOK) in Settings → AI Provider. Narration is optional — without a key, narration is skipped gracefully.

## 5. Deploy

```bash
npm run build
npx wrangler pages deploy dist --project-name unticket --branch main
cd cron && npx wrangler deploy && cd ..
```

Or wire up CI: `.github/workflows/ci.yml` runs lint/typecheck/tests, and `deploy-pages.yml` deploys Pages + applies D1 migrations + deploys the cron Worker on a green `main`. It needs repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

> **Migrations run before code** — the deploy workflow applies D1 migrations before `pages deploy` for this reason. If you deploy manually, run `d1 migrations apply` first.

## 6. Install the App and bootstrap

1. Install your GitHub App on your org (`https://github.com/apps/<your-app>/installations/new`).
2. The `installation.created` webhook enqueues a bootstrap job that syncs repos, members, issues, and PRs. The UI shows a setup overlay until it finishes.
3. The first user to authenticate for an org becomes its admin automatically.

## Operations

- **Cron:** reconciles every 30 min (catches missed webhooks, deletes, label changes) and archives `events` older than 90 days to R2 at the 03:00 UTC tick.
- **Background failures:** terminal queue failures land in the `op_failures` table; view them in Settings → Background failures (admin-only).
- **Manual event backfill:** Settings → Live Activity Backfill (admin-only) re-derives missing events over a 30-day window. Rate-limited to once per org per day.
- **Suspending an org:** set `suspended_at` on its `orgs` row to block all API access (`UPDATE orgs SET suspended_at = datetime('now') WHERE github_login = '<org>'`); set it back to `NULL` to restore.

## Costs

Unticket fits comfortably in Cloudflare's free/low tiers for a small org. The main variable cost is LLM narration (PR-merge narration only, paced, per-project toggle, BYOK-capable). The backfill endpoint is rate-limited to bound that spend.
