---
commit: ca74dc5
generated: 2026-10-04
scope: naming, formatting, imports, errors and logging
---

# Coding Conventions

Conventions below are stated in `AGENTS.md`, `CONTRIBUTING.md`, and enforced (or partially enforced) by config in the repo. Where a rule is aspirational rather than enforced, that is called out explicitly.

## Core Sections (Required)

### 1) Naming Rules

| Item | Rule | Example | Evidence |
|------|------|---------|----------|
| Files (non-React) | kebab-case (dot-separated "type" suffix for Nest components) | `zod-validation.pipe.ts`, `market-snapshot.worker.ts`, `assert-public-url.ts` | `apps/api/src/common/pipes/zod-validation.pipe.ts`; `apps/worker/src/market-snapshot.worker.ts` |
| React components | PascalCase `.tsx`, one component per file | `SkillTree.tsx`, `ApprovalQueue.tsx` | `apps/web/src/components/skills/SkillTree.tsx` |
| Hooks / utilities | camelCase | `useDrafts.ts`, `api-client.ts`, `chart-geometry.ts` | `packages/ui/src/useDrafts.ts`; `apps/web/src/lib/api-client.ts` |
| Functions/methods | camelCase, verb-first | `syncSkillState`, `encryptField`, `computeMatch` | `packages/aggregator/src/index.ts`; `packages/secrets/src/field.ts`; `packages/job-pipeline/src/stages/match.ts` |
| Types/interfaces | PascalCase; Zod schemas suffixed `Schema` | `NormalizedJob`, `SkillExtractSchema` | `packages/shared/src/schemas/index.ts` |
| Constants | UPPER_SNAKE_CASE | `QUEUE_GITHUB`, `EMBED_DIM`, `SENSITIVITY_LEVELS` | `packages/shared/src/queues.ts`, `packages/embeddings/src/local.ts` |
| Env vars | UPPER_SNAKE_CASE | `ENCRYPTION_KEY`, `TRUSTED_ORIGINS` | `.env.example` |
| DB tables/columns | snake_case in `@@map`/`@map`; Prisma models PascalCase | `candidate_skill_state`, `job_reject_log` | `apps/api/prisma/schema.prisma` |
| Migrations | descriptive snake_case name (never a date alone) | `add_evidence_source_column` | `AGENTS.md` §6; `apps/api/prisma/migrations/` |

### 2) Formatting and Linting

- **Formatter:** Prettier 3 configured in `.prettierrc` — `semi: true`, `singleQuote: true`, `trailingComma: "all"`, `printWidth: 100`, `tabWidth: 2`, `arrowParens: "always"`, plugin `prettier-plugin-tailwindcss`. Run with `pnpm format`.
- **Linter:** Two layers. `apps/web` runs **ESLint 9** via a flat config (`apps/web/eslint.config.mjs`, `eslint-config-next@16`); Next 16 removed `next lint`, so `pnpm lint` calls the ESLint CLI directly. A **root `.eslintrc.cjs` is a reference config that is not installed and not active** until a workspace adds ESLint + `extends: ["../../.eslintrc.cjs"]` (`.eslintrc.cjs:10-18`); `@careeros/api` has no working flat config and is excluded from the CI lint job. CI also runs the API typecheck, unit/integration tests, and Playwright (`.github/workflows/pr.yml`).
- **Most relevant enforced rules (root chain, when adopted):**
  1. `no-console: error` in production code (allow `warn`/`error`; tests/scripts/seeds exempt) — observability spec.
  2. `no-restricted-syntax` on `CallExpression[callee.property.name='chat']` — raw `provider.chat()` is forbidden outside `packages/ai`; use `chatStructured()` with a Zod schema per `plan/ai-safety.md` item 2.
  3. `data-testid` must be a string literal, never an interpolated expression — per `plan/testing.md`.
- **TypeScript strictness (enforced by `tsconfig.base.json`):** `strict`, `noImplicitAny`, `strictNullChecks`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noImplicitOverride`. `any` is disallowed unless justified inline.
- **Commands:** `pnpm lint` (turbo), `pnpm typecheck` (turbo), `pnpm format`.
- **Pre-commit:** `lefthook.yml` runs gitleaks (best-effort), workspace typecheck, and per-workspace lint on staged TS. Binary must be on PATH; hooks degrade gracefully.

### 3) Import and Module Conventions

- **Cross-workspace imports** use the `@careeros/*` package name (declared `workspace:*`); there are **no path aliases** in `tsconfig.base.json`, so imports like `@/foo` do not exist.
- **Intra-workspace imports** are relative. NestJS modules import sibling files by relative path (`./session.service`).
- **Barrel policy:** each package exposes `src/index.ts`. `@careeros/shared` also exposes explicit subpaths — `./schemas`, `./constants`, `./redact`, `./retry`, `./net` (`packages/shared/package.json` exports). `./net` is intentionally excluded from the barrel (`packages/shared/src/index.ts:18-19`).
- **Adapter rule:** never import an adapter from `apps/web` directly — go through a stable interface in `packages/` (`AGENTS.md` §5).
- **Reuse before rewrite:** check `packages/ui`, `packages/shared`, shadcn, lucide, stdlib first (`AGENTS.md` §6).

### 4) Error and Logging Conventions

- **Error strategy by layer:** NestJS services throw typed domain errors; global `LockoutExceptionFilter` maps `LockoutError` to HTTP 429 with `Retry-After` (`apps/api/src/common/filters/lockout.filter.ts`, registered `apps/api/src/main.ts:91`). Zod schemas validate at every trust boundary via `ZodValidationPipe`. `packages/sandbox` deliberately never throws — failures return `status: 'crash'`.
- **Logging:** all application logging goes through `pino` (JSON in prod, `pino-pretty` in dev). `console.log` is forbidden in application code (root lint rule; observability spec). Required stable context keys: `user_id`, `request_id`, `agent_role`, `prompt_id`, `prompt_hash`, `provider`, `model`, `job_id`, `duration_ms` (`plan/observability.md` §Logging).
- **Redaction:** `packages/shared/src/redact.ts` runs before log writes and Sentry `beforeSend`; redacts `Authorization`, `Cookie`, `api_key`, `token`, `password`, `refresh_token`, `client_secret`, AWS-style keys.
- **Retry/backoff:** all external calls go through `packages/shared/retry.ts` — exponential with full jitter, base 500ms, factor 2, max 30s, 3 attempts; `429` respects `Retry-After`; non-429 `4xx` fails fast; circuit breaker at 5 consecutive failures per (provider, endpoint) (`AGENTS.md` §6).
- **Timezone:** all timestamps stored UTC (`timestamptz`); user timezone in `user_prefs.timezone`; render with `Intl.DateTimeFormat(user.timezone)` client-side; never format server-side (`AGENTS.md` §6).

### 5) Testing Conventions

- **Test file naming/location:** unit tests are colocated `foo.ts` + `foo.test.ts`; integration tests are `*.integration.test.ts`; e2e are `*.spec.ts` under `apps/web/e2e/`; LLM evals are `packages/ai/src/evals/**/*.eval.ts`; contract tests are `*.contract.test.ts`. Vitest include globs: `packages/**/src/**/*.test.ts`, `apps/**/src/**/*.test.ts`, `scripts/**/*.test.ts` (`vitest.config.ts`).
- **Mocking strategy:** prefer real integration tests via Testcontainers over deep mocks (`CONTRIBUTING.md`); `msw` for external HTTP in unit tests only; never mock the DB in integration tests.
- **Coverage expectation:** **no coverage percentage target.** Behavior coverage is the rule — every phase checkbox has at least one verifying test. `retries: 0` in e2e; flakes are treated as bugs.
- **`fast-check`** for property-based tests on math-heavy paths (aggregator, priority formula, dedupe).
- **Ponytail rule:** any non-trivial module (branch, loop, parser, money/security path) leaves one runnable check (`AGENTS.md` §6).

### 6) Evidence

- `AGENTS.md` §6, §7, §9, §10; `CONTRIBUTING.md`
- `tsconfig.base.json`, `.prettierrc`, `.eslintrc.cjs`, `lefthook.yml`, `vitest.config.ts`
- `plan/observability.md`, `plan/testing.md`, `plan/security.md`
- `packages/shared/src/{retry,redact}.ts`, `apps/api/src/common/filters/lockout.filter.ts`

## Extended Sections

### Repo-specific commit / slice conventions

- Branch off `main`/`master`; keep diffs small; if a change exceeds ~400 lines across many files, split into named slices (e.g. `C-P1.5a`, `F.11c`) (`CONTRIBUTING.md` §Making a change).
- Commit subject + body describing the **why**; sign with `gitsign` when configured.
- No em dashes in user-facing strings (memory-enforced rule, `CONTRIBUTING.md`).
- Never commit generated files (`dist/`, `.d.ts`, `.js.map`) outside intentional artifacts.
- Never touch `plan/_audit_*.md` (historical audit records).

### Known convention violations / drift

- The root ESLint chain is **still not active** in any workspace that hasn't opted in (`.eslintrc.cjs:10-13`), so the three cross-cutting rules are not universally enforced today. `apps/web` ships its own eslint 9 flat config and is the only workspace gated in CI.
- T29 is **resolved**: `react-hooks/set-state-in-effect` is back to `error` in `apps/web/eslint.config.mjs`, and the `useApi` hook (`apps/web/src/lib/use-api.ts`) backs 19 panels so fetch-on-mount no longer sets state inside the effect synchronously.
- `AGENTS.md` §5 lists a `packages/storage` and `packages/github` that do not exist as packages; storage lives at `apps/api/src/common/storage.service.ts` and GitHub logic lives in `apps/api/src/modules/integrations/github/` plus `apps/worker/src/github-sync.ts`.
- `docs/dev-setup.md` now labels the remaining unwired commands (`pnpm seed:dev`, `pnpm ai:probe`) as "planned" rather than presenting them as available. See `CONCERNS.md`.
