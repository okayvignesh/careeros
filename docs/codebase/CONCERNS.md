---
commit: dead1a4
generated: 2026-10-02
scope: risks, technical debt, security and open questions
---

# Codebase Concerns

Prioritised from the scan output, config, and source inspection. Severities are relative to the product's stated threat model (`plan/security.md`, `plan/ai-safety.md`). `[TODO]` marks unknowns; `[ASK USER]` marks intent gaps.

## Core Sections (Required)

### 1) Top Risks (Prioritized)

| Severity | Concern | Evidence | Impact | Suggested action |
|----------|---------|----------|--------|------------------|
| High | **Embeddings are still a non-semantic placeholder** while product/UI promise semantic search | `packages/embeddings/src/local.ts` (SHA-256 → 384-d vector); `AGENTS.md` §4, `plan/PLAN.md:11` promise `bge-small-en` | Qdrant "semantic" search returns effectively hash-similarity results; match/evidence UX degrades | Ship the real local embedder (or provider adapter) and add a quality eval; document the limitation until then |
| High | **Intent docs still describe infrastructure absent from compose**: nginx/TLS, certbot, GlitchTip, whisper.cpp, embedding service, scheduler, backup sidecar | `docs/architecture.md` §2/§7; `docs/dev-setup.md`; `infra/` has no `nginx/` | Operators following docs hit missing services; "deploy on a VPS" is not yet fully real | Reconcile docs with the compose file, or implement the missing services; mark deferred ones clearly |
| Medium | **No global session guard; auth is enforced per-controller via `SessionService.requireUserId`** | `apps/api/src/modules/auth/auth.module.ts` (only `ThrottlerGuard` is global), 60+ call sites | One missed call = unauthenticated data access; multi-tenant readiness is weaker than schema suggests | Add a global auth guard (allowlist public routes) before multi-user lands |
| Medium | **Single LLM adapter (DeepSeek)** despite the provider-agnostic promise | `packages/ai/src/providers/` contains only `deepseek.ts` | No real fallback/provider choice; abstraction is theoretical | Add OpenAI/Anthropic/Ollama adapters + evals before relying on fallback |
| Medium | **Messaging package is orphaned**: `@careeros/messaging` defines the `Channel` interface but nothing instantiates it at runtime | `apps/api/src/modules/daily-brief/*`, `slack.oauth.ts` (comments only); no non-comment import | Channels are hard-wired to Slack rather than the promised transport-free registry | Wire `ChannelRegistry` or delete the unused package |
| Medium | **No nginx / TLS in compose**; `infra/nginx/` does not exist | `infra/`; `docs/architecture.md` §2/§7 | Public deployment lacks the documented reverse proxy/TLS story | Decide and implement the TLS/reverse-proxy story (`[ASK USER]` #2) |
| Medium | **`AppConfig` global keys not user-scoped** (multitenant TODOs) | `apps/api/src/modules/usage/usage.controller.ts:96,116,137`; `usage.service.ts:122` | Multi-user flip changes another user's config | Scope by `userId` before multi-user |
| Medium | **T29 — web fetch-on-mount still uses `useEffect` + `setState`**: 21 `react-hooks/set-state-in-effect` warnings | `apps/web/eslint.config.mjs` (rule downgraded to `warn`), `apps/web/src/components/**` | Warning noise; pattern should migrate to a data hook | Migrate panels to a data-fetching hook (SWR/React Query/`use()`) |
| Medium | **Live Docker egress smoke not run**: `scripts/smoke/egress.sh` exists but is not in CI and has not been executed against the full stack | `scripts/smoke/egress.sh`; `plan/CLEANUP_TASKS.md` progress log | The egress-bypass fix is unit/static-verified but not yet proven end-to-end | Run the smoke on a host with Docker and record the result |
| Low | **Root ESLint chain is still dormant**; the cross-cutting rules are not universally enforced and `@careeros/api` has no flat config | `.eslintrc.cjs:10-18`; `apps/web/eslint.config.mjs` (web has eslint 9); `pr.yml` excludes api lint | `no-console`, raw-`chat()` and literal-`data-testid` rules are documentation in api | Opt workspaces in or move rules to a real runner |
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

### 2) Technical Debt

| Debt item | Why it exists | Where | Risk if ignored | Suggested fix |
|-----------|---------------|-------|-----------------|---------------|
| Only one LLM adapter (DeepSeek) despite provider-agnostic promise | Provider abstraction built first, adapters deferred | `packages/ai/src/providers/` (only `deepseek.ts`) | Provider-agnosticism is theoretical; no fallback | Add OpenAI/Anthropic/Ollama adapters + evals before relying on fallback |
| `AppConfig` global keys not user-scoped | Single-user MVP | `apps/api/src/modules/usage/usage.controller.ts:96,116,137`; `TODO(multitenant)` markers | Multi-user flip changes another user's config | Scope by `userId` before multi-user |
| Interactive-transaction encryption gap | Prisma legacy `$use` middleware doesn't run in `tx.*` | `apps/api/src/prisma/prisma.service.ts:14-22` | Callers writing via `tx` must manually encrypt — easy to forget | Move to `$extends` or enforce via a repository layer |
| Fact-check only partial (sensitivity gate now unified) | Shipped incrementally; A6 unified the gate | `apps/api/src/common/sensitivity-gate.service.ts` (one authority); `apps/api/src/modules/resume-variants/` `runFactCheck`; `plan/ai-safety.md` items 6, 8 | Unbacked claims on un-wired surfaces (cover-letter/outreach) | Extract a shared fact-check helper; wire cover-letter + outreach |
| `llm_calls` tokenizer/pricing coverage still maturing | Per-call audit row + cost estimate now written by `makeLlmAuditor`; full accounting deferred | `apps/api/src/common/llm-audit.ts`; `plan/ai-safety.md` item 9 | Cost/audit visibility incomplete for providers/edge cases | Finish pricing rows + budget enforcement |
| N+1 in `JobsService.sync` + match-score pagination pool ceiling | Speed over query shape during rollout | `plan/PLAN.md:69` | Slow job lists as data grows | Batch/paginate; add query-count regression test |
| Phase slices deferred | Time-boxed waves | `plan/DEFERRED.md`; `plan/PLAN.md` status board | Documented flows are partial | Track each deferred slice to a deliverable |
| No `latest` tag / upgrade path untested | Pre-release | `plan/release-process.md`; `CHANGELOG.md` is `[Unreleased]` | First tagged upgrade may surprise operators | Test `compose pull && up` on previous data before v0.1.0 |

### 3) Security Concerns

| Risk | OWASP category (if applicable) | Evidence | Current mitigation | Gap |
|------|--------------------------------|----------|--------------------|-----|
| Per-controller auth instead of global guard | A01 Broken Access Control | `apps/api/src/modules/auth/auth.module.ts` | `requireUserId` call sites + `RequireAdminGuard` | No fail-closed global guard |
| Prompt injection via ingested content | A03 Injection | `packages/ai/src/wrap.ts`, `injection-scan.ts`; wired in jobs/market-brief/resume/dossier | `wrapUntrusted` + regex/heuristic scan + audit | LLM classifier pass and dedicated `llm_injection_log` table deferred; email path pending |
| Secrets could reach an external LLM | A02/A04 | `apps/api/src/common/sensitivity-gate.service.ts` (single authority, A6); `packages/shared/src/redact.ts` | Unified sensitivity gate + redaction pass; default policy never sends employer-confidential data externally | Employer-confidential default path still needs an end-to-end test |
| SSRF via user-supplied URLs | A10 SSRF | `packages/shared/src/net/assert-public-url.ts`; `PublicUrlSchema` | DNS-resolved, redirect-revalidated, host allowlist; tests present | Keep coverage as new integrations (self-hosted GitLab) land |
| Upload spoofing | A04 Insecure Design | `apps/api/src/common/storage.service.ts:30-73` | Magic-byte MIME check (PDF/DOCX), size limit, per-user keys, 5-min presign | DOCX check is shallow (documented upgrade path) |
| PII at rest partly unencrypted | A02 Cryptographic Failures | `packages/secrets/src/field.ts`; `plan/security.md` item 5 | Field encryption live for `resume_facts.content`, `llm_hallucination_log.snippet` | `career_goals`, `evidence`, `applications`, `outreach_messages` still to add |
| Prod TLS + Postgres SSL unchecked | A02/A05 | `plan/security.md` item 1 (unchecked boxes) | startup-check has HTTP/dev guards | Production HTTPS + `sslmode=require` enforcement not implemented |
| Master-key rotation flow unproven | A02 | `docs/architecture.md` §6 | Documented decrypt/re-encrypt flow, fresh re-auth required | No end-to-end test |
| Desktop agent trust chain = user's browser session | N/A | `plan/security.md` threat model | Pairing + JWT + keychain + pacing + kill-switch | Accepted risk; unsigned installers at MVP |

### 4) Performance and Scaling Concerns

| Concern | Evidence | Current symptom | Scaling risk | Suggested improvement |
|---------|----------|-----------------|-------------|-----------------------|
| N+1 in job sync | `plan/PLAN.md:69` | Not yet measured at scale | Slow ingestion as sources grow | Batch writes; query-count test |
| Match-score pagination pool ceiling | `plan/PLAN.md:69` | Not yet measured | Degraded match feed with many jobs | Keyset pagination |
| Placeholder embeddings | `packages/embeddings/src/local.ts` | Hash-similar results | Poor search precision regardless of scale | Real embedder + re-index |
| Global in-process LLM concurrency limit `p-limit(2)` per user | `apps/api/src/modules/usage/usage.service.ts:76-110` | Queueing under burst | Multi-replica needs shared limit | Move to Redis-backed limiter |
| Qdrant/Redis/MinIO single-instance | `infra/docker/docker-compose.yml` | N/A single-user | No HA; acceptable for self-host | Document as operator concern |

### 5) Fragile/High-Churn Areas

| Area | Why fragile | Churn signal | Safe change strategy |
|------|-------------|-------------|----------------------|
| `apps/api/src/app.module.ts` | Every new module touches it; ordering matters | 18 commits / 90d (scan) | Add modules surgically; run boot test |
| `apps/api/prisma/schema.prisma` | 55 models (39 migrations); migrations must be forward-safe | 17 commits / 90d | Named, idempotent, additive migrations; review |
| `packages/ai/src/index.ts` + prompt registry | Prompt/provider contract churn | 13 commits / 90d | Bump prompt versions; run evals |
| `pnpm-lock.yaml` | Dependency churn across 19 workspaces (4 apps + 15 packages) | 21 commits / 90d | Renovate + `pnpm install --frozen-lockfile` |
| `apps/api/package.json` | Repeated dependency adds | 14 commits / 90d | Keep versions aligned with worker |
| `infra/docker/docker-compose.yml` | Hardening/pins change frequently | 8 commits / 90d | Keep image-pin check green |
| `packages/shared/src/index.ts`, `packages/job-pipeline/src/index.ts` | Barrel exports are a wide blast radius | 6-7 commits / 90d | Add subpath exports rather than widening barrels |
| Plans themselves (`plan/COMPLETION_PLAN.md`, `HANDOFF.md`, `DEFERRED.md`) | Actively rewritten | 17/14/13 commits / 90d | Treat as source, but verify against code |

### 6) `[ASK USER]` Questions

1. **[ASK USER]** Is Career OS going OSS-public or staying personal-only? This blocks the LICENSE, `SECURITY.md` PGP key, install-doc polish, and several release blockers (`CONTRIBUTING.md`, `SECURITY.md`, `plan/PLAN.md:104-107`).
2. **[ASK USER]** What is the production TLS/reverse-proxy story — nginx + Let's Encrypt, Caddy, or a managed proxy? `infra/nginx/` does not exist yet (`docs/architecture.md` §2/§7).
3. **[ASK USER]** Which embedding model should ship as the real default — local `bge-small-en`, a hosted provider, or both? (`plan/PLAN.md:11` vs `packages/embeddings/src/local.ts`).
4. **[ASK USER]** Should the workspace converge on one React major (resume-render is React 18, web/ui are React 19)? Prisma is already converged on 6.x. (`packages/resume-render/package.json`, `apps/web/package.json`).
5. **[ASK USER]** When should multi-user become a supported deployment (and therefore force `AppConfig` scoping + a global auth guard)? (`TODO(multitenant)` markers).
6. **[ASK USER]** Should the root ESLint chain be activated everywhere, now that `apps/web` runs its own eslint 9 flat config and `@careeros/api` has no working config? (`.eslintrc.cjs:10-18`, `apps/web/eslint.config.mjs`).
7. **[ASK USER]** Where should encrypted backups ship (S3-compatible, Backblaze B2, or local path)? (`plan/PLAN.md:106`, `plan/security.md` item 8).
8. **[ASK USER]** Is the deferred GlitchTip/observability service intended for MVP or v1? It is specified but absent from compose (`plan/observability.md`).

### 7) Evidence

- Scan: `docs/codebase/.codebase-scan.txt` (TODO/FIXME/HACK list, HIGH-CHURN FILES, CODE METRICS, MONOREPO SIGNALS)
- Missing/candidate paths: shell inspection against `AGENTS.md` §5, `docs/dev-setup.md`, `docs/architecture.md` §2/§7; verified present: `packages/ui/src/motion.ts`, `scripts/dev-host.sh`, `scripts/seed-test.ts`, `infra/docker/docker-compose.host-dev.yml`
- Version alignment: `apps/api/package.json`, `apps/worker/package.json`, `packages/aggregator/package.json` (Prisma 6.x); remaining React-major divergence in `packages/resume-render/package.json`
- Config reality: `.eslintrc.cjs:10-18` (dormant root chain), `apps/web/eslint.config.mjs` (active eslint 9), `apps/web/package.json`
- Security/safety gaps: `plan/security.md`, `plan/ai-safety.md`, `plan/DEFERRED.md`, `docs/job-sources.md`
- Resolved-item fixes: `plan/CLEANUP_TASKS.md` progress log (Waves 1-14), `apps/api/src/main.ts`, `infra/docker/docker-compose.yml`, `packages/shared/src/net/proxy-dispatcher.ts`
- High-churn: `docs/codebase/.codebase-scan.txt` (GIT RECENT COMMITS, HIGH-CHURN FILES)
