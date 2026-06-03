# Security Policy

## Reporting a vulnerability

**Please do not open public GitHub issues for security vulnerabilities.**

Report security issues privately by email to **security@noboxdev.com**. Include:

- A description of the issue and its impact
- Steps to reproduce (a proof of concept if you have one)
- The affected component (frontend, Pages Functions, or the cron Worker) and version/commit

We will acknowledge your report within **3 business days** and keep you updated as we investigate and ship a fix. We're grateful for responsible disclosure and will credit reporters who wish to be named once a fix is released.

## Scope

In scope:

- The unticket web app (`src/`)
- The Cloudflare Pages Functions API (`functions/`)
- The sibling cron Worker (`cron/`)

Out of scope: vulnerabilities in third-party platforms (GitHub, Cloudflare) themselves — report those to the respective vendor.

## Handling secrets

Never commit secrets — API keys, OAuth client secrets, GitHub App private keys, webhook secrets, or encryption keys. All server-side secrets are provisioned as Cloudflare Pages/Worker secrets (see [DEPLOY.md](./DEPLOY.md)). Only the public `VITE_GITHUB_APP_CLIENT_ID` is safe to ship in the frontend bundle. If you discover a committed secret, report it via the channel above so it can be rotated.
