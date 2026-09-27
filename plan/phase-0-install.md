# Phase 0 — Install and first-run

**Status:** In progress (wizard end-to-end functional; MinIO / worker / testing / AI-safety / observability hardening in flight)
**Blueprint refs:** §29 (self-hosted), §29.1 (wizard flow), §29.13 (setup DoD)
**Screens in scope:** `careeros-screens/phase-0-install-and-first-run/` (screens 01–14, 65–67)

## Goal
A fresh `docker compose up` on a VPS gets you from empty database → dashboard, no source edits. Wizard configures AI provider, embeddings, integrations, resume, goals. Master encryption key backed up before completion.

## Definition of done
- Fresh clone → `cp .env.example .env` → set secrets → `docker compose up -d` reaches all-services-healthy.
- Uninitialized DB → auto-redirect to `/setup`.
- First user created via wizard (Argon2id).
- DeepSeek key entered, capability-tested (chat + structured output + tool calling + streaming).
- Local embeddings selected and vector round-trip verified against Qdrant.
- GitHub OAuth connected and at least one repo listed.
- Resume uploaded, parsed, facts previewed before commit.
- Career goals persisted.
- Health screen: Postgres, Redis, Qdrant, AI, embedding all green.
- Recovery key downloaded before setup completion.
- `/setup` redirects to dashboard after completion.
- Playwright test walks the whole wizard end-to-end.

## Checklist

### Infra & repo scaffolding
- [ ] Init git repo, `.gitignore`, `.editorconfig`, `.nvmrc`, Prettier/ESLint configs (not initialised as git repo yet)
- [x] Monorepo layout (`apps/web`, `apps/api`, `apps/worker`, `packages/{ai,auth,secrets,shared,ui,embeddings}`) — storage lives in `apps/api/src/common/storage.service.ts` (in-app, no dedicated package needed yet)
- [x] `pnpm` workspaces
- [~] `docker-compose.yml` — postgres, redis, qdrant, minio, api, web up; worker + nginx still pending
- [x] `docker-compose.override.yml` for local dev (bind mounts, hot reload)
- [x] `.env.example` with every var documented
- [ ] `infra/nginx/` reverse proxy + Let's Encrypt via `certbot` sidecar
- [ ] Volume strategy for postgres/qdrant/minio + `scripts/backup.sh` (nightly cron in compose)
- [x] Healthcheck endpoints on api; `docker compose ps` shows all healthy (worker healthcheck lands with worker service)
- [ ] README: prerequisites, quickstart, VPS deploy

### Backend — API skeleton
- [x] NestJS scaffold, TS strict mode, path aliases
- [x] Postgres via Prisma
- [x] Migration system + initial migration (users, setup_state, provider_configs, encrypted_secrets, integrations, resume_facts, goals, sessions)
- [x] Session middleware (iron-session, HttpOnly cookie, Secure, SameSite=Lax)
- [x] `/health` endpoint aggregating Postgres, Redis, Qdrant, AI provider, embedding
- [x] Zod-based request validation (`ZodValidationPipe`); global error filter pending
- [x] Encryption service (AES-GCM via `@careeros/secrets`, master key from `ENCRYPTION_KEY` env)
- [x] Secrets table + encrypt/decrypt on access

### Backend — Setup domain
- [x] `SetupStateService` (steps: account, provider, embeddings, integrations, resume, goals, recovery)
- [x] Route guard: if setup incomplete, all non-setup routes 302 to `/setup`
- [x] `POST /setup/account` — create first user (Argon2id)
- [x] `POST /setup/provider` — save encrypted key, capability-test (chat, JSON, tools, stream)
- [x] `POST /setup/embedding` — mode (local/external), test vector round-trip
- [x] `POST /setup/github` — OAuth start + callback, list repos
- [x] `POST /resume/parse` — upload → parse via LLM → archive raw file to MinIO (fire-and-forget), return facts
- [x] `POST /resume/confirm` — commit reviewed facts as evidence
- [x] `POST /setup/goals` — target roles, locations, comp, prefs
- [x] `GET /health` — matrix of services (aggregates Postgres, Redis, Qdrant, provider, embedding)
- [x] `POST /recovery/generate` — generate + display once
- [x] `POST /setup/recovery/acknowledge` — mark acknowledged
- [x] `POST /setup/complete` — flip flag

### Backend — AI provider abstraction
- [ ] `AIProvider` interface (chat, chatStructured, chatStream, tools, embed, capabilities)
- [ ] DeepSeek adapter (Responses API, JSON mode, function tools, streaming)
- [ ] Local embedding adapter (bge-small-en via `@xenova/transformers` or ONNX runtime)
- [ ] Provider registry + config-driven selection
- [ ] Capability probe used by wizard

### AI safety foundation (see `plan/ai-safety.md`)

#### Item 2 — Structured output enforcement
- [ ] `chatStructured<T>({schema})` is the only code-consumable method
- [ ] Schema validation on receipt; one retry on failure, then hard fail
- [ ] ESLint rule blocks `chat()` (prose) in non-UI modules

#### Item 3 — Prompt registry
- [ ] `packages/ai/prompts/` directory scaffolded
- [ ] Prompt file format: `id`, `version`, `system`, `userTemplate`, `schema`, `examples`
- [ ] SHA-256 prompt-hash computed per call
- [ ] Registry indexed at boot; unknown id = hard fail
- [ ] CI check: prompt change without version bump = block
- [ ] Two seed prompts: `capability-probe`, `injection-scan` (used later)

#### Item 8 — Sensitivity gate (scaffold)
- [ ] `packages/ai/sensitivity-gate.ts` with label enum: `public | personal | confidential | employer-confidential`
- [ ] Provider policy map in `app_config`; conservative defaults (employer-confidential → local only)
- [ ] Every call routes through gate before dispatch
- [ ] Blocked calls logged with reason
- [ ] Per-call opt-in requires re-auth <5 min + UI confirmation (wired in P1 when real sensitive data lands)

#### Item 9 — LLM call audit log
- [x] Migration: `llm_calls` (id, userId, provider, model, callKind, prompt/completion/total tokens, costUsd, latencyMs, ok, error, timestamp)
- [x] `packages/ai` DeepSeekProvider emits `LlmCallRecord` per call via `onCall` hook; API `makeLlmAuditor` persists via Prisma (fire-and-forget)
- [x] `packages/ai/pricing.ts` with DeepSeek price sheet (deepseek-chat + deepseek-reasoner)
- [ ] Per-user daily/monthly cost budget in `app_config`; over budget → 429 (deferred: needs UI + settings screen)
- [ ] Per-call token caps: input 32k, output 4k (per-prompt overridable) (deferred: not blocking P0)
- [ ] Circuit breaker: provider error > 20% in 5 min → fallback provider (deferred: needs second provider adapter)
- [ ] Retention: 90 days default (deferred: needs pg-cron sidecar in P6)

### Frontend — Design system foundation
- [x] Tailwind config with Linear/Vercel-style tokens (color scale, mono font, radii, spacing)
- [ ] Load `frontend-design` skill; produce `plan/DESIGN.md` with typography scale, palette, motion primitives
- [ ] shadcn/ui init + theme override to match tokens
- [x] Base components: Button, Input, Card, Badge, Toast, Dialog, Progress, Skeleton, Command (partial: Button, Input, Card, ErrorBanner shipped; rest as needed)
- [x] Layout primitives: PageShell, StepShell (wizard), NavRail, TopBar (WizardStep + SetupProgressBar shipped; NavRail/TopBar land with dashboard in P1)
- [ ] Dark-first, light optional; `prefers-reduced-motion` respected
- [x] Loader convention: every small spinner uses `thinking-orbs` (`<ThinkingOrb state="working" size={20|64} />`); no ad-hoc `Loader2` or CSS spinners

### Frontend — Wizard screens (14 real + 3 utility)
- [x] 01 Preflight (system requirements check)
- [x] 02 Create account
- [x] 03 AI provider (DeepSeek preselected)
- [x] 04 Capability test (live results, retry per capability)
- [x] 05 Embedding mode (local recommended)
- [x] 06 Embedding test
- [x] 07 GitHub connect + repo selector
- [x] 08 Integrations overview (skip-forward allowed)
- [x] 09 Resume import (upload PDF/DOCX → parse) — see [[docker-deps-workflow]]
- [x] 10 Fact review (accept / edit / reject per fact)
- [x] 11 Career goals
- [x] 12 Health check (all services)
- [x] 13 Recovery key (download-required to proceed)
- [x] 14 Setup complete → "Enter dashboard"
- [x] 65 Sign in (post-setup)
- [ ] 66 Service unavailable
- [ ] 67 Not found

### Testing infrastructure (see `plan/testing.md`)
- [ ] Vitest configured across all workspaces; colocation convention documented
- [ ] Testcontainers wired: Postgres + Redis + Qdrant + MinIO spin up per integration test file
- [ ] Playwright installed + configured — `fullyParallel: true`, retries: 0, storageState fixture for auth
- [ ] `@axe-core/playwright` integrated for a11y checks
- [ ] `msw` set up for external HTTP mocks in unit tests
- [ ] `fast-check` installed for property-based tests
- [ ] `scripts/seed-test.ts` — deterministic minimal fixture set for e2e
- [ ] Per-worker Postgres schema isolation for Playwright (`user_${WORKER_ID}`)
- [ ] `pnpm test` (unit), `pnpm test:integration`, `pnpm test:e2e`, `pnpm test:e2e:ui`, `pnpm test:a11y`, `pnpm test:visual`, `pnpm eval:ai`, `pnpm fixtures:record`
- [ ] Pre-commit hook (`lefthook` or `husky`) runs typecheck + lint + affected unit tests
- [ ] `.github/workflows/pr.yml` — typecheck, lint, unit, integration, build, Trivy, Playwright, a11y, audit, CodeQL
- [ ] `.github/workflows/restore-test.yml` — weekly backup restore verification
- [ ] `.github/workflows/nightly-evals.yml` — full LLM eval suite + drift alert
- [ ] `.github/workflows/tag-release.yml` — SBOM + cosign + GitHub Release
- [ ] Wall-clock budget: PR pipeline < 15 min

### Testing — P0 targets
- [ ] Unit: encryption service round-trip, redaction pass against known secret patterns, capability probe branches, setup state machine transitions
- [ ] Integration: setup endpoints against Testcontainers Postgres — every wizard step persists correctly
- [ ] Migration forward-safety: `apps/api/test/migrations/` scaffolded (first real test lands in P1)
- [ ] Playwright golden flow: fresh DB → walk full wizard → land on dashboard
- [ ] Playwright: sign-in after setup persists session
- [ ] Playwright: `checkA11y(page)` on every wizard screen
- [ ] Visual regression: baseline screenshots for every wizard screen (dark + light)
- [ ] Property-based (`fast-check`): `wrapUntrusted` round-trip, redaction never leaks secrets across any input

### Developer experience (DX)
- [ ] `docs/dev-setup.md` — clone → docker up → migrate → seed → sign in
- [ ] `scripts/seed-dev.ts` — realistic candidate: 12 skills, 3 repos, 20 evidence rows, 4 goals; run via `pnpm seed:dev`
- [ ] `Makefile` (or `justfile`) with common targets: `make dev`, `make test`, `make migrate`, `make seed`, `make down`
- [ ] `.vscode/launch.json` — attach debugger to api + worker
- [ ] `.vscode/settings.json` — format-on-save, ESLint, Tailwind IntelliSense
- [ ] Contributing guide: `CONTRIBUTING.md` at repo root with local setup, test commands, PR expectations
- [ ] Architecture one-pager: `docs/architecture.md` — single diagram + 1-page prose (complements AGENTS.md)

### API documentation
- [ ] `@nestjs/swagger` module wired; every controller + DTO decorated
- [ ] `/api/openapi.json` served
- [ ] Swagger UI at `/api/docs` (auth-gated in production)
- [ ] `prisma-erd-generator` runs on migration → ERD PNG committed to `docs/schema.png`

### Observability foundation (see `plan/observability.md`)
- [x] `pino` set up in api (nestjs-pino) + worker (plain pino); JSON prod / pino-pretty dev
- [ ] ESLint rule blocks `console.log` in application code (deferred: no console.log currently in app code, only boot fallback in main.ts)
- [x] `packages/shared/redact.ts` — key + regex redaction pass (nestjs-pino redacts cookie/auth headers/password/apiKey/token automatically)
- [x] Request-ID middleware; every request generates a UUID, echoed via `x-request-id` header + carried in every log line
- [ ] `prom-client` — `/metrics` endpoint on api + worker (private port)
- [ ] GlitchTip compose service; Sentry SDK integrated with `beforeSend` scrubbing
- [x] `GET /health` — parallel checks (Postgres, Redis, Qdrant, AI, embedding); MinIO check pending
- [ ] Docker `json-file` log driver with `max-size=10m`, `max-file=5`
- [ ] `docs/observability.md` — operator-facing setup

### Infra hardening
- [ ] Docker healthchecks on every service; compose depends_on with condition
- [ ] Resource limits on containers (memory, CPU) via compose
- [ ] Named volumes (not bind mounts) for postgres, qdrant, minio data
- [ ] Restart policy `unless-stopped` on every service
- [ ] `TRUSTED_ORIGINS` env for CORS — enforced strictly

### VPS-ready bits (day-1)
- [ ] nginx config with HTTP→HTTPS redirect
- [ ] certbot compose service (or `caddy` alternative — decide)
- [ ] `scripts/deploy.sh` — pull, migrate, compose up
- [ ] Nightly Postgres + MinIO backup script → destination TBD (parked)
- [ ] Only nginx bound to public; internal services on private network

### Security foundation (see `plan/security.md` for full acceptance criteria)

#### Item 1 — Secure defaults enforced at boot
- [ ] `apps/api/src/startup-check.ts` runs before Nest bootstrap
- [ ] `ENCRYPTION_KEY` ≥32 bytes, not in known-weak set, else exit 1
- [ ] `SESSION_SECRET` ≥32 bytes, not in known-weak set, else exit 1
- [ ] Production mode requires HTTPS + Postgres SSL, else exit 1
- [ ] Redact env values in startup logs (key names only)
- [ ] Unit tests for every negative case

#### Item 2 — Security headers + CSRF
- [ ] Helmet middleware wired with nonce-based CSP (no `unsafe-inline`, no `unsafe-eval`)
- [ ] `Strict-Transport-Security` with preload
- [ ] `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`
- [ ] `Permissions-Policy` locks camera/mic/geo/payment/usb off
- [ ] `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`
- [ ] Double-submit CSRF token on all `POST/PUT/PATCH/DELETE`; rotated per session
- [ ] Playwright asserts headers on `/`, `/setup`, `/api/health`
- [ ] `securityheaders.com` grade A verified

#### Item 3 — WebAuthn / passkey MFA
- [ ] `@simplewebauthn/server` + `@simplewebauthn/browser` integrated
- [ ] Register / login / revoke endpoints
- [ ] Multiple passkeys per user, named
- [ ] Session records auth method
- [ ] Sensitive-op guard requires re-auth <5 min old
- [ ] Setup wizard prompts passkey (not required)
- [ ] Playwright: register → sign out → sign in with passkey

#### Item 4 — Redis-backed rate limiter
- [ ] Global: 100 req/min per IP on `/api/*`
- [ ] Auth: 5 fails → 1-min lockout, doubling to 32 min, then passkey required
- [ ] Pairing: 5 attempts/hr per IP
- [ ] Setup: 20 req/min per IP
- [ ] Redis-backed, distributed across replicas
- [ ] `Retry-After` + `X-RateLimit-*` headers
- [ ] Lockouts logged as security events
- [ ] Unit tests: burst → 429, escalation curve

#### Item 6 (scaffold) — Zero telemetry + egress allowlist scaffold
- [ ] No analytics SDK in web app
- [ ] `NEXT_TELEMETRY_DISABLED=1` in web Dockerfile
- [ ] Self-hosted GlitchTip service in compose
- [ ] Worker container network policy scaffolding (real allowlist populated in P3)
- [ ] `docs/egress.md` initial version
- [ ] `USAGE_STATS=on` opt-in env var stub (off by default)

#### Item 8 (local) — Backup script
- [ ] `scripts/backup.sh`: `pg_dump -Fc` + Qdrant snapshot + MinIO rsync → tar → `age` encrypt → local path or S3-compatible
- [ ] `scripts/restore.sh`: reverse
- [ ] Compose cron sidecar runs nightly
- [ ] Retention: 7 daily + 4 weekly + 12 monthly
- [ ] `ENCRYPTION_KEY` NOT included in backup
- [ ] Manual restore tested once; CI restore test lands in P6
- [ ] `docs/backup.md` written

#### Item 9 — Trustable release chain
- [ ] `SECURITY.md` at repo root: disclosure email, PGP key, response commitment, 90-day window, scope
- [ ] `CONTRIBUTING.md` at repo root
- [ ] `CODE_OF_CONDUCT.md` at repo root
- [ ] GitHub Security Advisories enabled + test advisory dry-run
- [ ] Sigstore `gitsign` configured; branch protection on `main` requires signed commits
- [ ] CI publishes container images to GHCR
- [ ] `cosign` keyless OIDC signs every image
- [ ] Syft-generated CycloneDX SBOM published per image per release
- [ ] `SHA256SUMS` attached to GitHub Releases
- [ ] `docs/verify.md` with cosign verification steps
- [ ] Image digests pinned in `docker-compose.yml`, no `:latest`
- [ ] `CHANGELOG.md` scaffolded (Keep a Changelog format)

#### Item 10 — Vulnerability + container hygiene
- [ ] Renovate config committed; weekly PR cadence
- [ ] CI gate: `pnpm audit --prod --audit-level=high`
- [ ] CI gate: CodeQL on every PR
- [ ] CI gate: Trivy scan of built images, block on HIGH/CRITICAL
- [ ] `gitleaks` pre-commit hook + CI job
- [ ] Base images: distroless nodejs20-debian12 for api/worker; nginx:alpine pinned by digest
- [ ] All containers run as non-root UID
- [ ] Read-only rootfs with tmpfs for writable dirs
- [ ] Drop `ALL` Linux caps, add back only needed
- [ ] Seccomp default profile applied
- [ ] Compose file uses image SHA-256 digests

## Exit criteria
Tick every box above, flip status here to **Done** with date, update PLAN.md status board.
