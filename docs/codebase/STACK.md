---
commit: d31dead
generated: 2026-10-03
scope: languages, dependencies, toolchain, environment
---

# Technology Stack

Career OS is a self-hosted, provider-agnostic Personal AI Career Operating System. It is a pnpm/Turborepo monorepo written almost entirely in TypeScript, with a Next.js web app, a NestJS API, BullMQ workers, an Electron desktop agent, and an Expo (React Native) mobile companion. It is licensed **AGPL-3.0-or-later** (`LICENSE`, root `package.json:5`).

> Evidence for every row below is a committed manifest, config, or source file. `[TODO]` marks unknowable facts; `[ASK USER]` marks intent-dependent ones.

## Core Sections (Required)

### 1) Runtime Summary

| Area | Value | Evidence |
|------|-------|----------|
| Primary language | TypeScript (`.ts`/`.tsx`; ~895 source files — 757 `.ts` + 138 `.tsx`; ~112k LOC) | `docs/codebase/.codebase-scan.txt` (CODE METRICS); `tsconfig.base.json` |
| Runtime + version | Node.js >= 20 (see `.nvmrc`; root `engines.node`) | `package.json:6-8`, `.nvmrc` |
| Package manager | pnpm 9.12.0 (workspaces) | `package.json:5`, `pnpm-workspace.yaml:1-3` |
| Module/build system | Turborepo 2 (`turbo run build/typecheck/lint`), per-workspace `tsc`/`nest build`/`next build`/`expo` | `turbo.json:1-21`, `package.json:11-14` |
| Module format | ESM-ish `module: ESNext` + `moduleResolution: Bundler`; API compiled by Nest CLI, worker run with `tsx`, mobile via Expo/Metro | `tsconfig.base.json:4-5`, `apps/worker/package.json:6` |
| Workspace layout | `apps/*` + `packages/*` (5 apps, 15 packages) | `pnpm-workspace.yaml:1-3`; `packages/*/package.json` |

### 2) Production Frameworks and Dependencies

| Dependency | Version | Role in system | Evidence |
|------------|---------|----------------|----------|
| Next.js | 16.3.6 (pinned) | Web app, App Router, middleware | `apps/web/package.json` |
| React | ^19.3.0 | Web + UI component runtime | `apps/web/package.json` |
| NestJS (`@nestjs/common`/`core`) | ^10.4.4 | HTTP API, modules, DI, WebSockets gateway | `apps/api/package.json` |
| `@nestjs/platform-express` | ^10.4.22 | Express HTTP adapter (raw body for Slack HMAC) | `apps/api/package.json`, `apps/api/src/main.ts:88` |
| `@nestjs/platform-socket.io` + `socket.io` | ^10.4.4 / ^4.8.1 | Desktop-agent WSS pairing/task channel | `apps/api/package.json`, `apps/api/src/modules/agent/agent.gateway.ts` |
| Prisma + `@prisma/client` | ^6.19.3 (**aligned** across api, worker, and `@careeros/aggregator`) | ORM + migrations (56 models, 0 enums, 40 migrations) | `apps/api/package.json`, `apps/worker/package.json`, `packages/aggregator/package.json`, `apps/api/prisma/schema.prisma` |
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
| `@sentry/node` | ^11.4.0 | Error tracking against self-hosted GlitchTip; no-op without `SENTRY_DSN`, `beforeSend` runs shared redaction | `apps/api/package.json`, `apps/worker/package.json`, `apps/api/src/common/sentry.ts` |
| `@slack/web-api` | ^7.11.0 | Slack daily-assistant integration | `apps/api/package.json` |
| `googleapis` + `google-auth-library` | ^144.0.0 / ^9.15.0 | Gmail OAuth, watch, push ingest | `apps/api/package.json` |
| `@octokit/rest` | ^21.1.0 | GitHub repo sync in workers | `apps/worker/package.json` |
| `@react-pdf/renderer` + `docx` | ^4.9.0 / ^9.5.1 | Resume/cover-letter PDF + DOCX rendering | `packages/resume-render/package.json` |
| `electron` + `electron-updater` + `playwright-core` + `keytar` | ^31.3.1 / ^6.3.9 / ^1.47.2 / ^7.9.0 | Desktop companion agent | `apps/desktop/package.json` |
| `expo` + `expo-router` + `expo-secure-store` + `react-native` | ~57.0 / ~57.0.24 / ~57.0.4 / 0.86.3 (React 19.2.3) | Mobile companion app (iOS/Android); per-device token in the OS keychain | `apps/mobile/package.json`, `apps/mobile/app.json` |
| `@xenova/transformers` | ^2.17.2 | Local semantic embeddings (`Xenova/bge-small-en-v1.5`, 384-d) loaded lazily; deterministic SHA-256 fallback | `packages/embeddings/package.json`, `packages/embeddings/src/provider.ts` |
| `js-tiktoken` | ^1.0.21 | Pre-flight prompt-token estimation for cost caps + `LlmCall.estimatedPromptTokens` | `packages/ai/package.json`, `packages/ai/src/tokenize.ts` |
| `cheerio` | ^1.0.0 | Email-alert HTML parsing | `packages/email-parsers/package.json` |

**Notable production choices and reality checks**

- **Provider adapters ship for DeepSeek, OpenAI/OpenRouter, and local Ollama:** `packages/ai/src/providers/` holds `deepseek.ts`, `openai-compatible.ts` (shared by OpenAI + any OpenAI-compatible base URL), `ollama.ts` (native `/api/chat`, `prompt_eval_count`/`eval_count`), plus `fallback.ts` (5-failure/60s-open circuit breaker → primary → backup → Ollama last-resort) and `create.ts` (`createProvider`/`registerBuiltinProviders`). All are chat-only on the `AIProvider` surface (structured output yes; streaming/tools/embeddings no; Anthropic/Azure still absent). See `packages/ai/src/provider.ts`, `registry.ts`, `providers/`.
- **Embeddings are now a real provider seam (Wave B):** `packages/embeddings/src/provider.ts` selects `EMBEDDING_MODE` — `local` (default) lazy-loads `Xenova/bge-small-en-v1.5` through `@xenova/transformers` into `EMBEDDING_MODEL_CACHE_DIR`, `deterministic` is the offline SHA-256 fallback in `local.ts` (unchanged, 384-d), and `external` is a pluggable hosted adapter with none shipped. `local` is wrapped in `FallbackEmbeddingProvider`, so an offline/missing model degrades to deterministic with a warning and reports the effective mode (never a stale `bge-small-en` claim). The worker's `embedding.generate` job and `POST /embeddings/reembed` use the same seam.
- **Per-call LLM audit + injection audit are wired (Wave C):** `makeLlmAuditor` writes one `LlmCall` (`llm_calls`: prompt id/hash, sensitivity, tokens via `js-tiktoken` pre-flight + provider `usage`, cost split, latency, validation verdict) through a bounded queue that drops loudly; `InjectionAuditModule` persists `LlmInjectionLog` (`llm_injection_log`) rows for every suspect/blocked wrap-or-scan hit. See `apps/api/src/common/{llm-audit.ts,injection-log.ts,injection-audit.module.ts}`, `packages/ai/src/tokenize.ts`.
- **Master-key rotation is implemented (Wave C):** pure `rotateMasterKey(old, new, ctx)` in `@careeros/secrets` re-encrypts both `encrypted_secrets` rows and `enc:v1:` field values, idempotently (already-rotated rows are skipped on resume). `MasterKeyRotationService` walks them one transaction per row; `POST /me/security/rotate-key` is session + fresh-re-auth gated. See `packages/secrets/src/rotation.ts`, `apps/api/src/modules/me/master-key-rotation.service.ts`.
- **Swagger/OpenAPI is now real** (cleanup task U1): `@nestjs/swagger` (^7.4.2) + `@asteasolutions/zod-to-openapi` (^7.3.4) are declared and `apps/api/src/main.ts` serves the OpenAPI document at `/api/openapi.json` and Swagger UI at `/api/docs` (behind an auth gate in production). The old "no swagger dependency" caveat no longer applies.
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

- **Config sources:** `.env` (copied from `.env.example`), `apps/api/prisma/schema.prisma`, `apps/web/next.config.mjs`, `apps/web/tailwind.config.ts`, `apps/mobile/app.json`, `infra/docker/docker-compose.yml`, `infra/nginx/nginx.conf` + `infra/nginx/templates/careeros.conf.template`, per-workspace `tsconfig.json`, `packages/ui/src/tokens.css`.
- **Required env vars** (from `.env.example`): `POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PASSWORD`, `DATABASE_URL`, `REDIS_URL`, `QDRANT_URL`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_BUCKET`, `ENCRYPTION_KEY`, `SESSION_SECRET`, `API_PORT`, `WEB_PORT`, `WEB_URL`, `API_URL`, `TRUSTED_ORIGINS`, `SESSION_TTL_HOURS`. Optional/gated: `DEEPSEEK_API_KEY`, `FIRECRAWL_API_KEY`, `EMBEDDING_MODE` (+ `EMBEDDING_MODEL_CACHE_DIR`), `LOG_LEVEL`, `LOG_DEBUG`, `NEXT_TELEMETRY_DISABLED`, public-entrypoint `SERVER_NAME`/`HTTP_PORT`/`HTTPS_PORT`/`TLS_CERT_PATH`/`TLS_KEY_PATH`/`HSTS_MAX_AGE`/`ACME_EMAIL`, and backup `AGE_RECIPIENT`.
- **Boot-time enforcement:** `apps/api/src/startup-check.ts` refuses to start on missing/weak `ENCRYPTION_KEY`, `SESSION_SECRET`, or datastore credentials (<24 bytes or known-weak). Compose interpolates `${VAR:?...}` so a missing password aborts the stack.
- **Deployment/runtime constraints:** Docker Compose on a VPS; api/worker reach the internet only through an allowlisting Squid proxy; datastores on an `internal: true` network. All three app containers (api, worker, web) run `read_only` with a `tmpfs` scratch area, `cap_drop: ALL` (worker/web hold no caps), and `no-new-privileges:true` (`infra/docker/docker-compose.yml`). `undici`/`EnvHttpProxyAgent` enforces the proxy for Node global `fetch` (`apps/api/src/main.ts:97`, `apps/worker/src/main.ts:120`). **nginx is now present** (`infra/nginx/`) and is the only service publishing host ports (80/443), terminating TLS, redirecting `:80`→`:443` (except `/healthz` + ACME challenge), and routing `/`→web and `/api/*`→api; `certbot` renews every 12h, and an `ops`-profiled `backup` sidecar (`infra/docker/Dockerfile.backup`) writes age-encrypted artifacts. See `INTEGRATIONS.md` and `infra/nginx/README.md`.

### 6) Evidence

- `package.json` (AGPL-3.0-or-later), `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `turbo.json`, `tsconfig.base.json`, `.nvmrc`
- `apps/*/package.json`, `packages/*/package.json` (including `apps/mobile/`, `packages/aggregator/`, `packages/firecrawl/`)
- `.env.example`, `infra/docker/docker-compose.yml`, `infra/docker/Dockerfile.backup`, `infra/nginx/`, `apps/api/src/startup-check.ts`
- `apps/api/src/main.ts` (Swagger + egress + token-cap filter), `apps/worker/src/main.ts` (egress boot), `packages/shared/src/net/proxy-dispatcher.ts`
- `packages/embeddings/src/provider.ts`, `packages/ai/src/tokenize.ts`, `packages/secrets/src/rotation.ts`, `apps/api/src/common/{llm-audit.ts,injection-log.ts}`
- `docs/codebase/.codebase-scan.txt` (DIRECTORY TREE, STACK DETECTION, CODE METRICS)

## Extended Sections

### Docker base images (digest-pinned)

`infra/docker/docker-compose.yml`: `postgres:*`, `redis:*`, `qdrant/qdrant:v1.12.4`, `bitnamilegacy/minio`, `ubuntu/squid:6.10`, `nginx:alpine`, `certbot/certbot`, plus locally built `api`/`worker`/`web` images and the `ops`-profiled `backup` sidecar built from `infra/docker/Dockerfile.backup` (alpine + age/`mc`/`pg_dump`). `scripts/verify-image-pins.sh` fails CI if a floating tag is reintroduced (security spec item 10).

### Shared-package dependency graph (production deps only)

`@careeros/shared` (zod) is the base; `@careeros/ai`, `@careeros/job-pipeline`, `@careeros/email-parsers`, `@careeros/browser-agent`, `@careeros/firecrawl`, and `@careeros/aggregator` depend on it; `@careeros/embeddings` (Qdrant + `@xenova/transformers`) and `@careeros/resume-render` (React-PDF/docx) are leaf capabilities; `@careeros/messaging`, `@careeros/secrets`, `@careeros/auth`, `@careeros/sandbox`, `@careeros/ui`, `@careeros/testing` are independent. `@careeros/aggregator` (skill-state sync; type-only Prisma import) is consumed by both `apps/api` and `apps/worker`; `@careeros/firecrawl` (Firecrawl search/scrape/crawl client) is consumed by the worker and the job-pipeline adapter. `apps/api` and `apps/worker` compose all of the above; `apps/mobile` is standalone (no workspace deps — REST only). See `STRUCTURE.md` for the diagram.
