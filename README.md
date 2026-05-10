# Unticket

AI-powered project management dashboard for GitHub organisations.

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:5173 and sign in with a GitHub personal access token.

## Auth Modes

Unticket supports two authentication methods:

### Personal Access Token (default)
Works everywhere, no setup needed. Create a [GitHub PAT](https://github.com/settings/tokens/new?scopes=repo,read:org&description=Unticket) with `repo` and `read:org` scopes.

### GitHub OAuth (optional)
Enables the "Sign in with GitHub" button. Requires:
1. A [GitHub OAuth App](https://github.com/settings/applications/new)
2. A token exchange proxy (since GitHub's OAuth endpoints don't support CORS)

## Deploy

### GitHub Pages (free)

1. Enable Pages in repo settings (Source: GitHub Actions)
2. Optionally set up OAuth:
   - Create a GitHub OAuth App (callback URL: `https://yourname.github.io/unticket/api/auth/callback`)
   - Deploy the Cloudflare Worker in `/worker/` ([free tier](https://workers.cloudflare.com))
   - Add repo variables: `VITE_GITHUB_CLIENT_ID`, `VITE_OAUTH_PROXY_URL`
3. Push to main — auto-deploys via GitHub Actions

Without OAuth configured, users authenticate via personal access tokens.

### Vercel

1. Import the repo on [Vercel](https://vercel.com)
2. Add environment variables: `VITE_GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
3. Deploy — OAuth works out of the box via `/api/auth/callback`

## Stack

- React 19, TypeScript, Vite
- Tailwind CSS, Lucide icons
- TanStack Query, Octokit
- Vercel serverless functions (optional)
- Cloudflare Workers OAuth proxy (optional)

## Privacy

All data stays in the browser. Tokens are stored in localStorage. No telemetry, no analytics, no third-party servers.
