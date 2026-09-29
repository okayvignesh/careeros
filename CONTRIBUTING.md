# Contributing to Career OS

Career OS is currently a personal-use project in active alpha development.
External contributions are welcome but not expected until v1.0.

## Ground rules

- Follow the ponytail principle documented in `AGENTS.md`: **the laziest
  solution that actually works**. Prefer the standard library and native
  platform features over new dependencies. Reach for a helper that already
  lives in the codebase before writing a new one.
- No em dashes in any user-facing string (memory-enforced rule).
- Never commit generated files (`dist/`, `.d.ts`, `.js.map`) outside of
  intentional build artifacts.
- Never touch `plan/_audit_*.md` files (they are historical audit records).
- Prefer editing existing files over creating new ones.

## Development setup

1. `pnpm install`
2. `cp .env.example .env` and generate strong secrets:
   `openssl rand -hex 32` for both `MASTER_KEY` and `SESSION_SECRET`.
3. `pnpm docker:up` (Postgres + Redis + Qdrant + MinIO + Squid).
4. `pnpm migrate`
5. `pnpm dev` (Next.js at `:3000`, NestJS at `:3001`)

Full walkthrough in `docs/dev-setup.md`.

## Code layout

- `apps/api` - NestJS backend
- `apps/web` - Next.js frontend
- `apps/worker` - BullMQ workers
- `packages/*` - shared libraries (each `@careeros/*`)
- `plan/` - phase specs + audit + handoff docs
- `docs/` - operator + architecture docs

## Making a change

1. Branch off `main` (or `master`).
2. Keep the diff small. If a change grows past ~400 lines across many
   files, split it into slices with clear names (e.g. `C-P1.5a`,
   `F.11c`).
3. Write tests. New non-trivial logic without an adjacent test is a
   review blocker.
4. Run:
   - `pnpm typecheck` (all packages must pass)
   - `pnpm test` (unit + integration)
   - `pnpm lint`
5. Commit with a short subject + body describing the WHY. Sign the
   commit with `gitsign` if you have it set up.
6. Open a PR. CI runs on every push (`pnpm audit --prod`,
   image-pin check, typecheck, unit tests, adapter contract tests,
   nightly evals on cron).

## Testing conventions

- Prefer real integration tests (Testcontainers) over deep mocking.
- Unit tests colocate: `foo.ts` + `foo.test.ts` in the same dir.
- Fixtures live in `__fixtures__/` per package.
- Playwright golden flows live under `apps/web/e2e/`.
- Every LLM prompt has evals under `packages/ai/src/evals/<prompt-id>/`.

## Security-sensitive changes

Anything touching:
- Authentication / session handling
- Secret storage / encryption
- OAuth / integration scopes
- Egress paths (external HTTP)
- Admin routes
- Upload handling

...requires a `security-review` pass. Cite the relevant `plan/security.md`
item in the PR description.

## Reporting bugs

If you find a security issue, please read `SECURITY.md` first (do NOT
open a public issue). For non-security bugs, open a GitHub issue with
a minimal reproduction.

## License

License TBD pending the OSS-public vs personal-only decision (see
`plan/COMPLETION_PLAN.md` §6 open decision 2). Until then, treat this
repo as "all rights reserved" for redistribution purposes; personal
local use is fine.
