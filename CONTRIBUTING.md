# Contributing to unticket

Thanks for your interest in improving unticket. This is free, open-source software under the [GNU AGPL-3.0](./LICENSE) (`AGPL-3.0-or-later`). Contributions are welcome under that same license.

## Workflow

1. **Fork** the repo (`No-Box-Dev/unticket`) to your own account.
2. **Branch** off `main` with a descriptive name, e.g. `feat/issues-label-filter` or `fix/oauth-refresh-race`.
3. Make your change. Keep it focused — one logical change per PR.
4. **Open a pull request** against `No-Box-Dev/unticket:main`. Fill out the PR template.

## Required checks

Every PR must pass all of these locally before review:

```bash
npm run lint                  # ESLint
npm run build                 # frontend type-check (tsc -b) + Vite build
npm run typecheck:functions   # backend type-check (tsconfig.functions.json)
npm test                      # Vitest
```

CI runs the same checks. PRs that fail any of them will not be merged.

## Code conventions

- **Backend is TypeScript.** New Pages Functions and cron code are written in TypeScript, not JS. Existing hand-rolled `.js` endpoints migrate to this pattern opportunistically.
- **Validate at the boundary.** External request input must be validated with `validate(schema, input)` from `functions/lib/validate.ts` (zod). See `functions/api/assign.ts` for a validated write and `functions/api/engineer-stats.ts` for an aggregation read.
- **Use the D1 native binding** (`context.env.DB.prepare(...).bind(...)`, `DB.batch([...])`) and parameterized queries only — never string-concatenate SQL.
- **Surface errors.** Frontend writes go through the shared `apiGet/apiPut/apiPost/apiPatch/apiDelete` helpers in `src/lib/api.ts` so failures reach the user via the `ut:error` toast bus. Don't bypass them with raw `fetch` for mutations.
- Code should be obvious, boring, and correct. No dead code, no commented-out blocks, no `TODO` comments on `main` (open an issue instead).

## Update the docs

When you change the system surface, update the relevant docs in the same PR:

- **New tab** → `TabId` union in `src/lib/types.ts`, plus the Tab System and Features notes in `CLAUDE.md`.
- **New config key** → `VALID_KEYS`/`DEFAULTS` in `functions/api/config/[key].js`, plus the Config System notes.
- **New API route** → the API Routes list in `CLAUDE.md`.

## Code of Conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md). By participating you agree to uphold it.

## Licensing of contributions

By submitting a contribution, you agree that it is licensed under the same GNU AGPL-3.0 (`AGPL-3.0-or-later`) that covers the project, and that you have the right to license it under those terms.
