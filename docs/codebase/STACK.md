---
commit: 47be31a
generated: 2026-10-02
scope: languages, dependencies, toolchain, environment
---

# Technology Stack

Career OS is a self-hosted, provider-agnostic Personal AI Career Operating System. It is a pnpm/Turborepo monorepo written almost entirely in TypeScript, with a Next.js web app, a NestJS API, BullMQ workers, and an Electron desktop agent.

> Evidence for every row below is a committed manifest, config, or source file. `[TODO]` marks unknowable facts; `[ASK USER]` marks intent-dependent ones.

## Core Sections (Required)

### 1) Runtime Summary

| Area | Value | Evidence |
|------|-------|----------|
| Primary language | TypeScript (`.ts`/`.tsx`; 746 source files; ~91k LOC) | `docs/codebase/.codebase-scan.txt` (CODE METRICS); `tsconfig.base.json` |
| Runtime + version | Node.js >= 20 (see `.nvmrc`; root `engines.node`) | `package.json:6-8`, `.nvmrc` |
| Package manager | pnpm 9.12.0 (workspaces) | `package.json:5`, `pnpm-workspace.yaml:1-3` |
| Module/build system | Turborepo 2 (`turbo run build/typecheck/lint`), per-workspace `tsc`/`nest build`/`next build` | `turbo.json:1-21`, `package.json:11-14` |
| Module format | ESM-ish `module: ESNext` + `moduleResolution: Bundler`; API compiled by Nest CLI, worker run with `tsx` | `tsconfig.base.json:4-5`, `apps/worker/package.json:6` |
| Workspace layout | `apps/*` + `packages/*` (4 apps, 13 packages) | `pnpm-workspace.yaml:1-3` |

### 2) Production Frameworks and Dependencies

| Dependency | Version | Role in system | Evidence |
|------------|---------|----------------|----------|
| Next.js | 16.3.6 (pinned) | Web app, App Router, middleware | `apps/web/package.json` |
| React | ^19.3.0 | Web + UI component runtime | `apps/web/package.json` |
| NestJS (`@nestjs/common`/`core`) | ^10.4.4 | HTTP API, modules, DI, WebSockets gateway | `apps/api/package.json` |
| `@nestjs/platform-express` | ^10.4.22 | Express HTTP adapter (raw body for Slack HMAC) | `apps/api/package.json`, `apps/api/src/main.ts:88` |
| `@nestjs/platform-socket.io` + `socket.io` | ^10.4.4 / ^4.8.1 | Desktop-agent WSS pairing/task channel | `apps/api/package.json`, `apps/api/src/modules/agent/agent.gateway.ts` |
| Prisma + `@prisma/client` | ^6.19.3 | ORM + migrations (55 models, 0 enums, 38 migrations) | `apps/api/package.json`, `apps/api/prisma/schema.prisma` |
| PostgreSQL | 16-alpine (digest-pinned) | System of record | `infra/docker/docker-compose.yml` |
| Redis + BullMQ | redis:7-alpine / `bullmq ^5.13.0` | Queues, cache, rate-limit store | `infra/docker/docker-compose.yml`, `apps/worker/package.json` |
| Qdrant client | `@qdrant/js-client-rest ^1.12.0` | Vector store for semantic content | `packages/embeddings/package.json` |
| MinIO client | `minio ^8.0.2` | Object storage (resumes, artifacts, screenshots) | `apps/api/package.json`, `apps/api/src/common/storage.service.ts` |
| `argon2` | ^0.41.1 | Argon2id password hashing | `packages/auth/package.json:13` |
| `iron-session` | ^8.0.3 | Sealed session cookie (`__Host-*`, AES-256-GCM) | `apps/api/package.json`, `packages/auth/src/session.ts` |
| `@simplewebauthn/server` | ^11 | Passkey / WebAuthn MFA | `apps/api/package.json` |
| `helmet` | ^8.0.0 | Security headers + CSP nonce | `apps/api/src/main.ts:5,13-80` |
| `@nestjs/throttler` + `@nest-lab/throttler-storage-redis` | ^6.4.0 / ^1.2.0 | Redis-backed rate limiting | `apps/api/package.json`, `apps/api/src/modules/auth/auth.module.ts:21-31` |
| `zod` | ^3.23.8 | Trust-boundary validation (HTTP + LLM structured output) | `packages/shared/package.json`, `apps/api/src/common/pipes/zod-validation.pipe.ts` |
| `pino` + `nestjs-pino` | ^9.5.0 / ^4.1.0 | Structured JSON logging | `apps/api/package.json`, `plan/observability.md` |
| `prom-client` | ^15.1.3 | Prometheus metrics on `/metrics` | `apps/api/package.json`, `apps/api/src/common/metrics/` |
| `@slack/web-api` | ^7.11.0 | Slack daily-assistant integration | `apps/api/package.json` |
| `googleapis` + `google-auth-library` | ^144.0.0 / ^9.15.0 | Gmail OAuth, watch, push ingest | `apps/api/package.json` |
| `@octokit/rest` | ^21.1.0 | GitHub repo sync in workers | `apps/worker/package.json` |
| `@react-pdf/renderer` + `docx` | ^4.9.0 / ^9.5.1 | Resume/cover-letter PDF + DOCX rendering | `packages/resume-render/package.json` |
| `electron` + `electron-updater` + `playwright-core` + `keytar` | ^31.3.1 / ^6.3.9 / ^1.47.2 / ^7.9.0 | Desktop companion agent | `apps/desktop/package.json` |
| `cheerio` | ^1.0.0 | Email-alert HTML parsing | `packages/email-parsers/package.json` |

**Notable production choices and reality checks**

- **Only one LLM adapter ships today:** `packages/ai/src/providers/deepseek.ts`. The `AIProvider` abstraction and `ProviderRegistry` exist, but no OpenAI/Anthropic/Ollama adapter exists in the tree. DeepSeek is chat-only (structured output yes, streaming/tools/embeddings no). See `packages/ai/src/provider.ts`, `packages/ai/src/registry.ts`, `packages/ai/src/providers/`.
- **Embeddings are a placeholder:** `packages/embeddings/src/local.ts` returns a SHA-256-seeded, L2-normalised 384-d vector, not the `bge-small-en` / `@xenova/transformers` model promised in `AGENTS.md` §4 and `plan/PLAN.md`. No transformers dependency exists. See `CONCERNS.md`.
- **No `@nestjs/swagger` dependency exists**, despite `AGENTS.md` §6 requiring decorators and `/api/docs`; `docs/dev-setup.md:46` still points users at `http://localhost:3001/api/docs`.

### 3) Development Toolchain

| Tool | Purpose | Evidence |
|------|---------|----------|
| Turborepo 2.11.2 | Task orchestration + cache | `package.json`, `turbo.json` |
| TypeScript 5.9.3 (^5.6.3) | Strict compilation (`strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`) | `tsconfig.base.json` |
| Prettier 3.9.8 + `prettier-plugin-tailwindcss` | Formatting | `.prettierrc` |
| ESLint 8 (`next lint` in web; root `.eslintrc.cjs` is a reference config) | Lint: no `console.log`, no raw `provider.chat(`, literal `data-testid` | `.eslintrc.cjs`, `apps/web/package.json` |
| Vitest 5 | Unit + integration runner | `vitest.config.ts`, `package.json` |
| Testcontainers 10.28 | Real Postgres/Redis/Qdrant/MinIO for integration tests | `packages/testing/package.json`, `packages/testing/src/index.ts` |
| Playwright 1.63 | E2E, a11y, visual | `apps/web/playwright.config.ts`, `apps/web/e2e/` |
| `fast-check` 4.10 | Property-based tests | `package.json`, `packages/testing/src/index.ts` |
| `msw` 2.15 | External HTTP mocks (unit) | `packages/testing/src/index.ts` |
| `@axe-core/playwright` 4.10 | WCAG 2.1 AA checks | `apps/web/package.json` |
| lefthook | Pre-commit gitleaks + typecheck + lint | `lefthook.yml`, `package.json:10` |
| ESLint (dormant root chain) | Cross-cutting rules; requires workspaces to opt in | `.eslintrc.cjs:10-18` |

### 4) Key Commands

```bash
pnpm install                       # install all workspace deps
pnpm docker:up                     # build shared pkgs + start full compose stack
pnpm migrate                       # prisma migrate deploy
pnpm dev                           # turbo run dev --parallel (api + web + worker)
pnpm build                         # turbo run build
pnpm typecheck                     # turbo run typecheck
pnpm lint                          # turbo run lint
pnpm test                          # vitest run (unit + integration)
pnpm test:unit                     # excludes integration + e2e
pnpm test:integration              # vitest run integration.test
pnpm test:e2e                      # @careeros/web Playwright
pnpm test:evals                    # @careeros/ai LLM evals (EVAL_MOCK=1 default)
make help                          # shortcut help (Makefile)
```

### 5) Environment and Config

- **Config sources:** `.env` (copied from `.env.example`), `apps/api/prisma/schema.prisma`, `apps/web/next.config.mjs`, `apps/web/tailwind.config.ts`, `infra/docker/docker-compose.yml`, per-workspace `tsconfig.json`, `packages/ui/src/tokens.css`.
- **Required env vars** (from `.env.example`): `POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PASSWORD`, `DATABASE_URL`, `REDIS_URL`, `QDRANT_URL`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_BUCKET`, `ENCRYPTION_KEY`, `SESSION_SECRET`, `API_PORT`, `WEB_PORT`, `WEB_URL`, `API_URL`, `TRUSTED_ORIGINS`, `SESSION_TTL_HOURS`. Optional/gated: `DEEPSEEK_API_KEY`, `LOG_LEVEL`, `LOG_DEBUG`, `NEXT_TELEMETRY_DISABLED`.
- **Boot-time enforcement:** `apps/api/src/startup-check.ts` refuses to start on missing/weak `ENCRYPTION_KEY`, `SESSION_SECRET`, or datastore credentials (<24 bytes or known-weak). Compose interpolates `${VAR:?...}` so a missing password aborts the stack.
- **Deployment/runtime constraints:** Docker Compose on a VPS; api/worker reach the internet only through an allowlisting Squid proxy; datastores on an `internal: true` network; api container runs `read_only`, `cap_drop: ALL`, `no-new-privileges`. `[TODO]` TLS/reverse-proxy (nginx) is planned but no `infra/nginx/` directory exists in the tree.

### 6) Evidence

- `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `turbo.json`, `tsconfig.base.json`, `.nvmrc`
- `apps/*/package.json`, `packages/*/package.json`
- `.env.example`, `infra/docker/docker-compose.yml`, `apps/api/src/startup-check.ts`
- `docs/codebase/.codebase-scan.txt` (DIRECTORY TREE, STACK DETECTION, CODE METRICS)

## Extended Sections

### Docker base images (digest-pinned)

`infra/docker/docker-compose.yml`: `postgres:*`, `redis:*`, `qdrant/qdrant:v1.12.4`, `bitnamilegacy/minio`, `ubuntu/squid:6.10`, plus locally built `api`/`worker`/`web` images. `scripts/verify-image-pins.sh` fails CI if a floating tag is reintroduced (security spec item 10).

### Shared-package dependency graph (production deps only)

`@careeros/shared` (zod) is the base; `@careeros/ai`, `@careeros/job-pipeline`, `@careeros/email-parsers`, `@careeros/browser-agent` depend on it; `@careeros/embeddings` (Qdrant) and `@careeros/resume-render` (React-PDF/docx) are leaf capabilities; `@careeros/messaging`, `@careeros/secrets`, `@careeros/auth`, `@careeros/sandbox`, `@careeros/ui`, `@careeros/testing` are independent. `apps/api` and `apps/worker` compose all of the above. See `STRUCTURE.md` for the diagram.
