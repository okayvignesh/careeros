---
commit: dead1a4
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
| Primary language | TypeScript (`.ts`/`.tsx`; 812 source files — 687 `.ts` + 125 `.tsx`; ~101k LOC) | `docs/codebase/.codebase-scan.txt` (CODE METRICS); `tsconfig.base.json` |
| Runtime + version | Node.js >= 20 (see `.nvmrc`; root `engines.node`) | `package.json:6-8`, `.nvmrc` |
| Package manager | pnpm 9.12.0 (workspaces) | `package.json:5`, `pnpm-workspace.yaml:1-3` |
| Module/build system | Turborepo 2 (`turbo run build/typecheck/lint`), per-workspace `tsc`/`nest build`/`next build` | `turbo.json:1-21`, `package.json:11-14` |
| Module format | ESM-ish `module: ESNext` + `moduleResolution: Bundler`; API compiled by Nest CLI, worker run with `tsx` | `tsconfig.base.json:4-5`, `apps/worker/package.json:6` |
| Workspace layout | `apps/*` + `packages/*` (4 apps, 15 packages) | `pnpm-workspace.yaml:1-3`; `packages/*/package.json` |

### 2) Production Frameworks and Dependencies

| Dependency | Version | Role in system | Evidence |
|------------|---------|----------------|----------|
| Next.js | 16.3.6 (pinned) | Web app, App Router, middleware | `apps/web/package.json` |
| React | ^19.3.0 | Web + UI component runtime | `apps/web/package.json` |
| NestJS (`@nestjs/common`/`core`) | ^10.4.4 | HTTP API, modules, DI, WebSockets gateway | `apps/api/package.json` |
| `@nestjs/platform-express` | ^10.4.22 | Express HTTP adapter (raw body for Slack HMAC) | `apps/api/package.json`, `apps/api/src/main.ts:88` |
| `@nestjs/platform-socket.io` + `socket.io` | ^10.4.4 / ^4.8.1 | Desktop-agent WSS pairing/task channel | `apps/api/package.json`, `apps/api/src/modules/agent/agent.gateway.ts` |
| Prisma + `@prisma/client` | ^6.19.3 (**aligned** across api, worker, and `@careeros/aggregator`) | ORM + migrations (55 models, 0 enums, 39 migrations) | `apps/api/package.json`, `apps/worker/package.json`, `packages/aggregator/package.json`, `apps/api/prisma/schema.prisma` |
| `@nestjs/swagger` + `@asteasolutions/zod-to-openapi` | ^7.4.2 / ^7.3.4 | OpenAPI JSON at `/api/openapi.json` + Swagger UI at `/api/docs`, generated from the shared Zod schemas | `apps/api/package.json`, `apps/api/src/main.ts:125-142`, `apps/api/src/openapi/openapi.ts` |
| `undici` | ^6 | Egress enforcement: installs an `EnvHttpProxyAgent` as the process-global `fetch` dispatcher at api/worker boot so Squid actually gates Node global `fetch` | `packages/shared/package.json`, `packages/shared/src/net/proxy-dispatcher.ts`, `apps/api/src/main.ts:97`, `apps/worker/src/main.ts:120` |
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

- **Provider adapters ship for DeepSeek, OpenAI/OpenRouter, and local Ollama:** `packages/ai/src/providers/` holds `deepseek.ts`, `openai-compatible.ts` (shared by OpenAI + any OpenAI-compatible base URL), `ollama.ts` (native `/api/chat`, `prompt_eval_count`/`eval_count`), plus `fallback.ts` (5-failure/60s-open circuit breaker → primary → backup → Ollama last-resort) and `create.ts` (`createProvider`/`registerBuiltinProviders`). All are chat-only on the `AIProvider` surface (structured output yes; streaming/tools/embeddings no). See `packages/ai/src/provider.ts`, `registry.ts`, `providers/`.
- **Embeddings are still a placeholder:** `packages/embeddings/src/local.ts` returns a SHA-256-seeded, L2-normalised 384-d vector, not the `bge-small-en` / `@xenova/transformers` model promised in `AGENTS.md` §4 and `plan/PLAN.md`. No transformers dependency exists. See `CONCERNS.md`.
- **Swagger/OpenAPI is now real** (cleanup task U1): `@nestjs/swagger` + `zod-to-openapi` are declared and `apps/api/src/main.ts` serves the OpenAPI document at `/api/openapi.json` and Swagger UI at `/api/docs` (behind an auth gate in production). The old "no swagger dependency" caveat no longer applies.
- **Prisma is one major across the workspace** (cleanup T11): api, worker, and `@careeros/aggregator` all use `@prisma/client`/`prisma` `^6.19.3`. `apps/api` wires `postinstall: prisma generate` (plus `prebuild`) so a clean install generates the client.

### 3) Development Toolchain

| Tool | Purpose | Evidence |
|------|---------|----------|
| Turborepo 2.11.2 | Task orchestration + cache | `package.json`, `turbo.json` |
| TypeScript 5.9.3 (^5.6.3) | Strict compilation (`strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`) | `tsconfig.base.json` |
| Prettier 3.9.8 + `prettier-plugin-tailwindcss` | Formatting | `.prettierrc` |
| **ESLint 9** in `apps/web` (`eslint.config.mjs`, `eslint-config-next@16`); root `.eslintrc.cjs` is still a dormant reference config | Web lint: Next core-web-vitals + TypeScript rules; cross-cutting `no-console`/raw-`chat()`/literal-`data-testid` rules live in the root config, not yet adopted by workspaces | `.eslintrc.cjs`, `apps/web/package.json`, `apps/web/eslint.config.mjs` |
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
- **Deployment/runtime constraints:** Docker Compose on a VPS; api/worker reach the internet only through an allowlisting Squid proxy; datastores on an `internal: true` network. All three app containers (api, worker, web) run `read_only` with a `tmpfs` scratch area, `cap_drop: ALL` (worker/web hold no caps), and `no-new-privileges:true` (`infra/docker/docker-compose.yml`; cleanup T8). `undici`/`EnvHttpProxyAgent` now enforces the proxy for Node global `fetch` (`apps/api/src/main.ts:97`, `apps/worker/src/main.ts:120`; cleanup T6). `[TODO]` TLS/reverse-proxy (nginx) is still planned but no `infra/nginx/` directory exists in the tree.

### 6) Evidence

- `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `turbo.json`, `tsconfig.base.json`, `.nvmrc`
- `apps/*/package.json`, `packages/*/package.json` (including new `packages/aggregator/`, `packages/firecrawl/`)
- `.env.example`, `infra/docker/docker-compose.yml`, `apps/api/src/startup-check.ts`
- `apps/api/src/main.ts` (Swagger + egress boot), `apps/worker/src/main.ts` (egress boot), `packages/shared/src/net/proxy-dispatcher.ts`
- `docs/codebase/.codebase-scan.txt` (DIRECTORY TREE, STACK DETECTION, CODE METRICS)

## Extended Sections

### Docker base images (digest-pinned)

`infra/docker/docker-compose.yml`: `postgres:*`, `redis:*`, `qdrant/qdrant:v1.12.4`, `bitnamilegacy/minio`, `ubuntu/squid:6.10`, plus locally built `api`/`worker`/`web` images. `scripts/verify-image-pins.sh` fails CI if a floating tag is reintroduced (security spec item 10).

### Shared-package dependency graph (production deps only)

`@careeros/shared` (zod) is the base; `@careeros/ai`, `@careeros/job-pipeline`, `@careeros/email-parsers`, `@careeros/browser-agent`, `@careeros/firecrawl`, and `@careeros/aggregator` depend on it; `@careeros/embeddings` (Qdrant) and `@careeros/resume-render` (React-PDF/docx) are leaf capabilities; `@careeros/messaging`, `@careeros/secrets`, `@careeros/auth`, `@careeros/sandbox`, `@careeros/ui`, `@careeros/testing` are independent. `@careeros/aggregator` (skill-state sync; type-only Prisma import) is consumed by both `apps/api` and `apps/worker`; `@careeros/firecrawl` (Firecrawl search/scrape/crawl client) is consumed by the worker and the job-pipeline adapter. `apps/api` and `apps/worker` compose all of the above. See `STRUCTURE.md` for the diagram.
