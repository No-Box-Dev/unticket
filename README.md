# Unticket

AI-powered project-management dashboard for GitHub organisations. Unticket syncs your org's pull requests, issues, members, and activity into a fast dashboard with a features kanban, engineer stats, and an event feed — backed by GitHub data, no manual ticket-keeping.

**Hosted (free):** [app.unticket.ai](https://app.unticket.ai) · **Self-host:** see [DEPLOY.md](./DEPLOY.md) · **Architecture:** see [ARCHITECTURE.md](./ARCHITECTURE.md)

> **License:** Unticket is free, open-source software under the [GNU AGPL-3.0](./LICENSE) (`AGPL-3.0-or-later`). Self-host and modify it freely; if you expose a modified version as a network service, you must share the source under the same license. See [LICENSE](./LICENSE).

## Quick start (local dev)

```bash
npm install
npm run dev
```

Open http://localhost:5173. By default the dev server proxies `/api/*` to the hosted instance; sign in with a GitHub personal access token (`repo`, `read:org` scopes) to try the UI. To run the full stack (backend Functions, D1, OAuth) against your own infrastructure, follow [DEPLOY.md](./DEPLOY.md).

Set `VITE_API_TARGET` in `.env.local` to point the dev proxy at your own deployment. See [.env.example](./.env.example) for all configuration.

## Auth modes

- **GitHub App + OAuth** (recommended for self-host/production) — "Sign in with GitHub", real-time webhooks, refresh-token rotation. Requires registering your own GitHub App.
- **Personal Access Token** — works with zero backend setup, but is read-only: webhooks can't be created in PAT mode, so data is only as fresh as the last manual sync.

## Stack

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS, TanStack Query, Octokit, Radix UI, Lucide icons
- **Backend:** Cloudflare Pages Functions + D1 (SQLite), a sibling cron Worker, Cloudflare Queues + R2
- **Testing:** Vitest + Testing Library

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Production build |
| `npm test` | Run the Vitest suite |
| `npm run lint` | ESLint |
| `npm run typecheck` | Frontend type-check |
| `npm run typecheck:functions` | Backend (Functions + cron) type-check |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md). To report a security issue, see [SECURITY.md](./SECURITY.md).

## Privacy

Self-hosted instances keep all data in your own Cloudflare account. For the hosted instance, see [PRIVACY.md](./PRIVACY.md) and [TERMS.md](./TERMS.md).
