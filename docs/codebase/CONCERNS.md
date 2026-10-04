---
commit: d31dead
generated: 2026-10-03
scope: risks, technical debt, security and open questions
---

# Codebase Concerns

Prioritised from the scan output, config, and source inspection. Severities are relative to the product's stated threat model (`plan/security.md`, `plan/ai-safety.md`). `[TODO]` marks unknowns; `[ASK USER]` marks intent gaps.

## Core Sections (Required)

### 1) Top Risks (Prioritized)

| Severity | Concern | Evidence | Impact | Suggested action |
|----------|---------|----------|--------|------------------|
| High | **No global session guard; auth is enforced per-controller via `SessionService.requireUserId`** | `apps/api/src/modules/auth/auth.module.ts` (only `ThrottlerGuard` is global), 60+ call sites | One missed call = unauthenticated data access; multi-tenant readiness is weaker than schema suggests | Add a global auth guard (allowlist public routes) before multi-user lands |
| Low | **Verbal recordings have no retention sweep** | `apps/api/src/modules/assessments/verbal-audio.store.ts`; `plan/phase-2-assessment-arena.md:101` calls for auto-delete after 30 days | Audio accumulates in MinIO indefinitely | Add a periodic prune over `verbal_sessions.audioKey` older than the retention window (P6 consumer work) |
| Medium | **`AppConfig` global keys not user-scoped** (multitenant TODOs) | `apps/api/src/modules/usage/usage.controller.ts:96,116,137`; `usage.service.ts:122` | Multi-user flip changes another user's config | Scope by `userId` before multi-user |
| Medium | **Live Docker egress smoke not run**: `scripts/smoke/egress.sh` exists but is not in CI and has not been executed against the full stack | `scripts/smoke/egress.sh`; `plan/CLEANUP_TASKS.md` progress log | The egress-bypass fix is unit/static-verified but not yet proven end-to-end | Run the smoke on a host with Docker and record the result |
| Medium | **Prompt evals are thin and unregistered**: 2 `*.eval.ts` files; the daily workflow exists but the runner registration is deferred | `packages/ai/src/evals/`, `.github/workflows/nightly-evals.yml` | LLM regressions may ship unnoticed | Register the eval runner; grow skill-extract cases toward the blueprint target (`packages/ai/src/evals/skill-extract.ts:4`) |
| Medium | **Mobile companion is read-only with no push/offline and no tests** | `apps/mobile/README.md`, `plan/phase-7-mobile.md` | Phone users get live-only reads; regressions uncovered | Ship push/offline + a mobile smoke when the phase advances |
| Low | **Anthropic/Azure have no adapter**; fallback/circuit-breaker state is in-process | `packages/ai/src/providers/` (DeepSeek/OpenAI-compatible/Ollama/fallback); `apps/api/src/common/provider-loader.service.ts` breaker `Map` | Those provider ids fall back (or 404) rather than dispatch; multi-replica would not share breaker state | Add adapters if needed; move breaker to Redis for multi-replica |
| Low | **Root ESLint chain is still dormant**; the cross-cutting rules are not universally enforced and `@careeros/api` has no flat config | `.eslintrc.cjs:10-18`; `apps/web/eslint.config.mjs` (web has eslint 9); `pr.yml` excludes api lint | `no-console`, raw-`chat()` and literal-`data-testid` rules are documentation in api | Opt workspaces in or move rules to a real runner |
| Low | **Desktop installers are unsigned at MVP** | `plan/security.md` threat model; `apps/desktop/electron-builder.yml` | OS warnings on install; trust chain is the user's browser session | Sign mac/win installers at release |
| Low | **`docs/dev-setup.md` still names planned scripts** (`pnpm seed:dev`, `pnpm ai:probe`) | root `package.json`; `docs/dev-setup.md:70,84` | Readers may try commands that are not wired yet (now labelled "planned") | Implement or keep explicitly marked as planned |

### 1b) Resolved during the 2026-10-02 cleanup (with the fix)

| Former concern | Fix landed | Evidence |
|----------------|-----------|----------|
| `packages/ui/src/motion.ts` missing while the barrel re-exported it (build blocker) | File added and re-exported; `@careeros/ui` resolves | `packages/ui/src/motion.ts`, `packages/ui/src/index.ts` (T1) |
| Two Prisma majors across workspaces (api 6 / worker 5) | Worker + api + aggregator all on `@prisma/client`/`prisma` `^6.19.3` | `apps/worker/package.json`, `apps/api/package.json`, `packages/aggregator/package.json` (T11) |
| Egress bypass — Node global `fetch` ignored proxy env vars, so Squid did not gate app traffic | `installEgressProxy()` installs an undici `EnvHttpProxyAgent` at api/worker boot and fails closed | `packages/shared/src/net/proxy-dispatcher.ts`, `apps/api/src/main.ts:97`, `apps/worker/src/main.ts:120` (T6) |
| `@nestjs/swagger` absent while `AGENTS.md` §6 mandated it | `@nestjs/swagger` + `zod-to-openapi` added; `/api/openapi.json` + `/api/docs` served behind an auth gate | `apps/api/src/main.ts:125-142`, `apps/api/src/openapi/` (T2/U1) |
| api/worker containers not hardened | worker + web joined api with `read_only`, `tmpfs`, `cap_drop: ALL`, `no-new-privileges` | `infra/docker/docker-compose.yml` (T8) |
| GitHub Actions pinned to floating tags | Every `uses:` pinned to a full commit SHA with a version comment | `.github/workflows/pr.yml` and siblings (T9) |
| Build blockers: resume-render TSX types, `@careeros/ai`/`job-pipeline` builds, shared `./net` subpath, api missing `email-parsers` dep, clean-clone `prisma generate`, out-of-sync lockfile | All fixed; central `turbo run typecheck` reached 31/31 with all packages building | `plan/CLEANUP_TASKS.md` progress log (T16, T17, T20, T21, T22, T23, T24, T25, T26, T27) |
| Missing referenced paths/scripts | `scripts/dev-host.sh`, `scripts/seed-test.ts`, `infra/docker/docker-compose.host-dev.yml` implemented and wired | `package.json` scripts (`dev:host`, `seed:test`, `docker:infra`) (T3) |
| Missing no-analytics direct-deps test | Test added | `apps/web/src/no-analytics-sdk.test.ts` (T4) |
| `pnpm.overrides` contradiction / commit-shape (T5, T7, T10, T15) | GCM `authTagLength`, sign-up advisory lock, Slack OAuth `state` binding, trusted client IP all fixed | `plan/CLEANUP_TASKS.md` verifier notes |
| Duplicated skill-state sync, provider loading, match scorer, sensitivity gate | Extracted to `@careeros/aggregator`, `ProviderLoaderService`, `packages/job-pipeline/src/stages/match.ts`, `SensitivityGateService` | `packages/aggregator/src/index.ts`, `apps/api/src/common/provider-loader.service.ts`, `packages/job-pipeline/src/stages/match.ts` (A1, A2, A3, A6) |
| Approvals could silently drop an unhandled kind | Dispatch now audits + `markFailed` for unregistered kinds (fails loud) | `apps/api/src/modules/approvals/approvals.service.ts:341,365` (A7) |
| Web components fabricated fixture data on API failure | Explicit unavailable state instead | market-demand + search-providers components (A8) |
| CI lacked lint + Playwright; integration coverage thin | `pr.yml` gained lint + seeded Playwright jobs; integration files grew 4 → 7 | `.github/workflows/pr.yml`, `apps/api/src/**/*.integration.test.ts` (C2, C4) |

### 1c) Resolved during Waves A–C (2026-10-03, `d31dead`)

| Former concern | Fix landed | Evidence |
|----------------|-----------|----------|
| Missing endpoints (market demand, search providers) the web expected | `MarketDemandModule` + `SearchProvidersModule` controllers/services return Zod-validated envelopes; panels render explicit unavailable state | `apps/api/src/modules/{market-demand,search-providers}/`, `apps/web/src/components/market-demand/market-data.ts` |
| `@careeros/messaging` orphaned (define-only `Channel` interface) | `ChannelRegistry` + `SlackChannel`/`WebChannel` are instantiated in `DailyBriefModule`/`daily-brief-delivery.service.ts`; unregistered channels fail as `channel_not_registered` | `apps/api/src/modules/daily-brief/daily-brief.module.ts`, `daily-brief-delivery.service.ts` |
| Web components fabricated fixture data on API failure | Zod boundary helpers + explicit unavailable state (A8), unit-tested | `apps/web/src/components/market-demand/market-data.ts`, `search-providers/providers-data.ts` + `*.test.ts` |
| No desktop devices UI | `DevicesPanel` (list/revoke), `AgentDownloadCard`, and `/settings/devices` ship | `apps/web/src/components/settings/{DevicesPanel,AgentDownloadCard}.tsx`, `apps/web/src/app/(app)/settings/devices/page.tsx` |
| `agent_form_fill` deferred | F.3 form-fill (allowlist + per-site scripts + selector-health) shipped and wired into the task runner | `packages/browser-agent/src/`, `apps/desktop/src/task-runner.ts`, `scripts/browser-agent/` |
| Embeddings were a SHA-256 placeholder (contract violated) | Real provider seam: default `Xenova/bge-small-en-v1.5` via `@xenova/transformers`, deterministic offline fallback, external seam; worker + reembed use it | `packages/embeddings/src/provider.ts`, `apps/worker/src/embedding-job.ts`, `apps/api/src/modules/embeddings/` |
| Single LLM provider (DeepSeek only) | OpenAI/OpenRouter (`openai-compatible.ts`) + local Ollama adapters with a primary→backup→Ollama fallback chain and 5-failure breaker | `packages/ai/src/providers/`, `apps/api/src/common/provider-loader.service.ts` |
| Swagger/OpenAPI absent while `AGENTS.md` mandates it | (also in 1b) `/api/openapi.json` + `/api/docs` generated from shared Zod schemas | `apps/api/src/main.ts:125-142`, `apps/api/src/openapi/` (U1/T2) |
| No nginx / TLS / backup in compose | `nginx` (only public ports, TLS, ACME) + `certbot` (12h renew) + `ops`-profiled `backup` sidecar (`Dockerfile.backup`) | `infra/nginx/`, `infra/docker/docker-compose.yml`, `infra/docker/Dockerfile.backup` |
| T29 web fetch-on-mount `useEffect`+`setState` warnings | `useApi` data hook adopted by 19 panels; `react-hooks/set-state-in-effect` restored to `error` | `apps/web/src/lib/use-api.ts`, `apps/web/eslint.config.mjs:22` |
| AI-safety logs missing (hallucination/injection ledger surface) | `LlmCall` (`llm_calls`) per-call audit with `js-tiktoken` pre-flight tokens + `LlmInjectionLog` (`llm_injection_log`) for wrap/scan hits; bounded drop-loudly queue | `apps/api/src/common/{llm-audit.ts,injection-log.ts,injection-audit.module.ts}`, `packages/ai/src/tokenize.ts`, `apps/api/prisma/schema.prisma` |
| Master-key rotation flow unproven | Pure idempotent `rotateMasterKey` + `MasterKeyRotationService` + re-auth-gated `POST /me/security/rotate-key`, with unit tests | `packages/secrets/src/rotation.ts`, `apps/api/src/modules/me/master-key-rotation.service.ts` |

### 2) Technical Debt

| Debt item | Why it exists | Where | Risk if ignored | Suggested fix |
|-----------|---------------|-------|-----------------|---------------|
| Provider adapters now ship (DeepSeek/OpenAI-compatible/Ollama) but Anthropic/Azure are absent and breaker state is in-process | Adapters added incrementally | `packages/ai/src/providers/`, `apps/api/src/common/provider-loader.service.ts` | Those ids fall back/404; multi-replica breaker state not shared | Add adapters if needed; move breaker to Redis; add per-adapter evals |
| `AppConfig` global keys not user-scoped | Single-user MVP | `apps/api/src/modules/usage/usage.controller.ts:96,116,137`; `TODO(multitenant)` markers | Multi-user flip changes another user's config | Scope by `userId` before multi-user |
| Interactive-transaction encryption gap | Prisma legacy `$use` middleware doesn't run in `tx.*` | `apps/api/src/prisma/prisma.service.ts:14-22` | Callers writing via `tx` must manually encrypt — easy to forget | Move to `$extends` or enforce via a repository layer |
| Fact-check only partial (sensitivity gate now unified) | Shipped incrementally; A6 unified the gate | `apps/api/src/common/sensitivity-gate.service.ts` (one authority); `apps/api/src/modules/resume-variants/` `runFactCheck`; `plan/ai-safety.md` items 6, 8 | Unbacked claims on un-wired surfaces (cover-letter/outreach) | Extract a shared fact-check helper; wire cover-letter + outreach |
| `llm_calls` pricing/budget coverage still maturing | Per-call audit + `js-tiktoken` pre-flight estimate + `llm_injection_log` now written; full cost accounting + budget enforcement deferred | `apps/api/src/common/llm-audit.ts`, `packages/ai/src/tokenize.ts`; `plan/ai-safety.md` item 9 | Cost/audit visibility incomplete for providers/edge cases | Finish pricing rows + budget enforcement |
| N+1 in `JobsService.sync` + match-score pagination pool ceiling | Speed over query shape during rollout | `plan/PLAN.md:69` | Slow job lists as data grows | Batch/paginate; add query-count regression test |
| Phase slices deferred | Time-boxed waves | `plan/DEFERRED.md`; `plan/PLAN.md` status board | Documented flows are partial | Track each deferred slice to a deliverable |
| No `latest` tag / upgrade path untested | Pre-release | `plan/release-process.md`; `CHANGELOG.md` is `[Unreleased]` | First tagged upgrade may surprise operators | Test `compose pull && up` on previous data before v0.1.0 |

### 3) Security Concerns

| Risk | OWASP category (if applicable) | Evidence | Current mitigation | Gap |
|------|--------------------------------|----------|--------------------|-----|
| Per-controller auth instead of global guard | A01 Broken Access Control | `apps/api/src/modules/auth/auth.module.ts` | `requireUserId` call sites + `RequireAdminGuard` | No fail-closed global guard |
| Prompt injection via ingested content | A03 Injection | `packages/ai/src/wrap.ts`, `injection-scan.ts`; wired in jobs/market-brief/resume/dossier | `wrapUntrusted` + regex/heuristic scan + `llm_injection_log` audit row per flag | LLM classifier pass still deferred; email path coverage to confirm |
| Secrets could reach an external LLM | A02/A04 | `apps/api/src/common/sensitivity-gate.service.ts` (single authority, A6); `packages/shared/src/redact.ts` | Unified sensitivity gate + redaction pass; default policy never sends employer-confidential data externally | Employer-confidential default path still needs an end-to-end test |
| SSRF via user-supplied URLs | A10 SSRF | `packages/shared/src/net/assert-public-url.ts`; `PublicUrlSchema` | DNS-resolved, redirect-revalidated, host allowlist; tests present | Keep coverage as new integrations (self-hosted GitLab) land |
| Upload spoofing | A04 Insecure Design | `apps/api/src/common/storage.service.ts:30-73` | Magic-byte MIME check (PDF/DOCX), size limit, per-user keys, 5-min presign | DOCX check is shallow (documented upgrade path) |
| PII at rest partly unencrypted | A02 Cryptographic Failures | `packages/secrets/src/field.ts`; `plan/security.md` item 5 | Field encryption live for `resume_facts.content`, `llm_hallucination_log.snippet` | `career_goals`, `evidence`, `applications`, `outreach_messages` still to add |
| Prod TLS + Postgres SSL unchecked | A02/A05 | `plan/security.md` item 1 (unchecked boxes) | startup-check has HTTP/dev guards | Production HTTPS + `sslmode=require` enforcement not implemented |
| Master-key rotation flow unproven | A02 | `packages/secrets/src/rotation.ts`, `apps/api/src/modules/me/master-key-rotation.service.ts` | Implemented + unit-tested; idempotent, stops on undecryptable row, re-auth gated | No full-stack rotation rehearsal recorded yet |
| Desktop agent trust chain = user's browser session | N/A | `plan/security.md` threat model | Pairing + JWT + keychain + pacing + kill-switch | Accepted risk; unsigned installers at MVP |

### 4) Performance and Scaling Concerns

| Concern | Evidence | Current symptom | Scaling risk | Suggested improvement |
|---------|----------|-----------------|-------------|-----------------------|
| N+1 in job sync | `plan/PLAN.md:69` | Not yet measured at scale | Slow ingestion as sources grow | Batch writes; query-count test |
| Match-score pagination pool ceiling | `plan/PLAN.md:69` | Not yet measured | Degraded match feed with many jobs | Keyset pagination |
| Embedding provider fallback | `packages/embeddings/src/provider.ts`, `apps/worker/src/embedding-job.ts` | Real `bge-small-en` by default; offline degrades to deterministic | Pre-provider-switch vectors are hash-similar and need re-embedding | Enable local mode + re-embed legacy vectors; add a quality eval |
| Global in-process LLM concurrency limit `p-limit(2)` per user | `apps/api/src/modules/usage/usage.service.ts:76-110` | Queueing under burst | Multi-replica needs shared limit | Move to Redis-backed limiter |
| Qdrant/Redis/MinIO single-instance | `infra/docker/docker-compose.yml` | N/A single-user | No HA; acceptable for self-host | Document as operator concern |

### 5) Fragile/High-Churn Areas

| Area | Why fragile | Churn signal | Safe change strategy |
|------|-------------|-------------|----------------------|
| `apps/api/src/app.module.ts` | Every new module touches it; ordering matters | 18 commits / 90d (scan) | Add modules surgically; run boot test |
| `apps/api/prisma/schema.prisma` | 56 models (40 migrations); migrations must be forward-safe | 19 commits / 90d | Named, idempotent, additive migrations; review |
| `packages/ai/src/index.ts` + prompt registry | Prompt/provider contract churn | 13 commits / 90d | Bump prompt versions; run evals |
| `pnpm-lock.yaml` | Dependency churn across 19 workspaces (4 apps + 15 packages) | 21 commits / 90d | Renovate + `pnpm install --frozen-lockfile` |
| `apps/api/package.json` | Repeated dependency adds | 14 commits / 90d | Keep versions aligned with worker |
| `infra/docker/docker-compose.yml` | Hardening/pins change frequently | 8 commits / 90d | Keep image-pin check green |
| `packages/shared/src/index.ts`, `packages/job-pipeline/src/index.ts` | Barrel exports are a wide blast radius | 6-7 commits / 90d | Add subpath exports rather than widening barrels |
| Plans themselves (`plan/COMPLETION_PLAN.md`, `HANDOFF.md`, `DEFERRED.md`) | Actively rewritten | 17/14/13 commits / 90d | Treat as source, but verify against code |

### 6) `[ASK USER]` Questions

1. **[ASK USER]** Should the workspace converge on one React major (resume-render is React 18, web/ui are React 19; mobile pins 19.2.3)? Prisma is already converged on 6.x. (`packages/resume-render/package.json`, `apps/web/package.json`, `apps/mobile/package.json`).
2. **[ASK USER]** When should multi-user become a supported deployment (and therefore force `AppConfig` scoping + a global auth guard)? (`TODO(multitenant)` markers).
3. **[ASK USER]** Should the root ESLint chain be activated everywhere, now that `apps/web` runs its own eslint 9 flat config and `@careeros/api` has no working config? (`.eslintrc.cjs:10-18`, `apps/web/eslint.config.mjs`).
4. **[ASK USER]** Where should encrypted backups ship (S3-compatible, Backblaze B2, or local path)? (`plan/PLAN.md:106`, `plan/security.md` item 8).
5. **[ASK USER]** When should GlitchTip error tracking be enabled for real (the service + SDK wiring now ship behind `ops`/`observability` + `SENTRY_DSN`; the web `@sentry/nextjs` layer is still a follow-up)? (`docs/observability.md`).
6. **[ASK USER]** When does the mobile companion get push/offline and store distribution (EAS)? It is read-only and live-fetch only today (`plan/phase-7-mobile.md`).
7. **[ASK USER]** When are desktop installers signed, and on which platforms? (`plan/release-process.md`, `apps/desktop/electron-builder.yml`).

> Resolved in Waves A–C: the OSS/license decision (**AGPL-3.0-or-later** shipped), the TLS/reverse-proxy story (**nginx + certbot** shipped), and the real embedding model (**local `bge-small-en` default** with deterministic fallback + external seam).

### 7) Evidence

- Scan: `docs/codebase/.codebase-scan.txt` (TODO/FIXME/HACK list, HIGH-CHURN FILES, CODE METRICS, MONOREPO SIGNALS)
- Missing/candidate paths: shell inspection against `AGENTS.md` §5, `docs/dev-setup.md`, `docs/architecture.md` §2/§7; all previously-dangling paths now exist (`packages/ui/src/motion.ts`, `scripts/dev-host.sh`, `scripts/seed-test.ts`, `infra/docker/docker-compose.host-dev.yml`, `infra/nginx/`, `infra/docker/Dockerfile.backup`)
- Version alignment: `apps/api/package.json`, `apps/worker/package.json`, `packages/aggregator/package.json` (Prisma 6.x); remaining React-major divergence in `packages/resume-render/package.json`
- Config reality: `.eslintrc.cjs:10-18` (dormant root chain), `apps/web/eslint.config.mjs` (active eslint 9, `set-state-in-effect: error`), `apps/web/package.json`
- Security/safety gaps: `plan/security.md`, `plan/ai-safety.md`, `plan/DEFERRED.md`, `docs/job-sources.md`, `plan/phase-7-mobile.md`
- Resolved-item fixes: `plan/CLEANUP_TASKS.md` progress log (Waves 1-14) plus Waves A–C (`34d312a`, `d31dead`); `apps/api/src/main.ts`, `infra/docker/docker-compose.yml`, `infra/nginx/`, `packages/shared/src/net/proxy-dispatcher.ts`, `packages/embeddings/src/provider.ts`, `packages/ai/src/providers/`, `apps/api/src/common/{llm-audit,injection-log}.ts`, `packages/secrets/src/rotation.ts`, `apps/web/src/lib/use-api.ts`
- High-churn: `docs/codebase/.codebase-scan.txt` (GIT RECENT COMMITS, HIGH-CHURN FILES)
