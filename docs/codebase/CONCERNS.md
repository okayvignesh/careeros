---
commit: 47be31a
generated: 2026-10-02
scope: risks, technical debt, security and open questions
---

# Codebase Concerns

Prioritised from the scan output, config, and source inspection. Severities are relative to the product's stated threat model (`plan/security.md`, `plan/ai-safety.md`). `[TODO]` marks unknowns; `[ASK USER]` marks intent gaps.

## Core Sections (Required)

### 1) Top Risks (Prioritized)

| Severity | Concern | Evidence | Impact | Suggested action |
|----------|---------|----------|--------|------------------|
| High | **Embeddings are a non-semantic placeholder** while product/UI promise semantic search | `packages/embeddings/src/local.ts` (SHA-256 → 384-d vector); `AGENTS.md` §4, `plan/PLAN.md:11` promise `bge-small-en` | Qdrant "semantic" search returns effectively hash-similarity results; match/evidence UX degrades | Ship the real local embedder (or provider adapter) and add a quality eval; document the limitation until then |
| High | **Intent docs describe infrastructure that does not exist**: nginx/TLS, certbot, GlitchTip, whisper.cpp, embedding service, scheduler, backup sidecar, `docker-compose.host-dev.yml`, `scripts/dev-host.sh`, `scripts/seed-test.ts` | `docs/architecture.md` §2/§7; `docs/dev-setup.md:24,46`; missing-path check | Operators following docs hit missing services/commands; "deploy on a VPS" is not yet real | Reconcile docs with the compose file, or implement the missing services; mark deferred ones clearly |
| High | **`packages/ui/src/index.ts` re-exports `./motion` but `packages/ui/src/motion.ts` does not exist** | `packages/ui/src/index.ts`; missing-path check | Any consumer importing `@careeros/ui` can fail to build/typecheck | Add the file or remove the re-export |
| High | **Two Prisma major versions across workspaces** (`@prisma/client ^6.19.3` in api, `^5.20.0` in worker) | `apps/api/package.json`, `apps/worker/package.json` | Generated client/schema drift; migrations and queries can diverge silently | Pin one Prisma version workspace-wide |
| Medium | **No global session guard; auth is enforced per-controller via `SessionService.requireUserId`** | `apps/api/src/modules/auth/auth.module.ts`, 60+ call sites; only `ThrottlerGuard` is global | One missed call = unauthenticated data access; multi-tenant readiness is weaker than schema suggests | Add a global auth guard (allowlist public routes) before multi-user lands |
| Medium | **Root ESLint chain is inactive; it is not installed and no workspace extends it** | `.eslintrc.cjs:10-18` | `no-console`, raw-`chat()` and literal-`data-testid` rules are documentation, not enforcement | Opt workspaces in or move rules to a real runner |
| Medium | **Missing direct-deps no-analytics test**: the web guard references `apps/web/src/no-analytics-sdk.test.ts`, which is not in the tree | `scripts/__tests__/no-analytics-in-web.test.ts`; `plan/PENDING_2026-10-02.md` | Zero-telemetry guarantee is only partially verified | Add the missing test |
| Medium | **`@nestjs/swagger` absent** though `AGENTS.md` §6 mandates it and `docs/dev-setup.md:46` advertises `/api/docs` | no `@nestjs/swagger` in any `package.json`; no `SwaggerModule` usage | API docs URL 404s; agent/developer contract docs missing | Add Swagger decorators + serve OpenAPI, or remove the claim |
| Low | **`docs/dev-setup.md` references many non-existent scripts** (`pnpm check`, `pnpm prisma`, `pnpm erd`, `pnpm ai:probe`, `pnpm seed:dev`, `pnpm eval:ai`, `pnpm test:visual`, `pnpm fixtures:record`) | root `package.json` scripts; `docs/dev-setup.md` §Common tasks | New contributors hit "missing script" | Add the scripts or correct the table |

### 2) Technical Debt

| Debt item | Why it exists | Where | Risk if ignored | Suggested fix |
|-----------|---------------|-------|-----------------|---------------|
| Only one LLM adapter (DeepSeek) despite provider-agnostic promise | Provider abstraction built first, adapters deferred | `packages/ai/src/providers/` (only `deepseek.ts`) | Provider-agnosticism is theoretical; no fallback | Add OpenAI/Anthropic/Ollama adapters + evals before relying on fallback |
| `AppConfig` global keys not user-scoped | Single-user MVP | `apps/api/src/modules/usage/usage.controller.ts:96,116,137`; `TODO(multitenant)` markers | Multi-user flip changes another user's config | Scope by `userId` before multi-user |
| Interactive-transaction encryption gap | Prisma legacy `$use` middleware doesn't run in `tx.*` | `apps/api/src/prisma/prisma.service.ts:14-22` | Callers writing via `tx` must manually encrypt — easy to forget | Move to `$extends` or enforce via a repository layer |
| Sensitivity gate + fact-check only partial | Shipped incrementally | `packages/ai/src/sensitivity-gate.ts`; `apps/api/src/modules/resume-variants/` `runFactCheck`; `plan/ai-safety.md` items 6, 8 | Employer-confidential leakage / unbacked claims on un-wired surfaces | Extract shared fact-check helper; wire cover-letter + outreach |
| `llm_calls` audit middleware + tokenizer incomplete | Per-call caps shipped, full accounting deferred | `plan/ai-safety.md` item 9; `packages/ai/src/providers/deepseek.ts` | Cost/audit visibility incomplete | Finish middleware, pricing rows, budget enforcement |
| N+1 in `JobsService.sync` + match-score pagination pool ceiling | Speed over query shape during rollout | `plan/PLAN.md:69` | Slow job lists as data grows | Batch/paginate; add query-count regression test |
| Phase slices deferred | Time-boxed waves | `plan/DEFERRED.md`; `plan/PLAN.md` status board | Documented flows are partial | Track each deferred slice to a deliverable |
| No `latest` tag / upgrade path untested | Pre-release | `plan/release-process.md`; `CHANGELOG.md` is `[Unreleased]` | First tagged upgrade may surprise operators | Test `compose pull && up` on previous data before v0.1.0 |

### 3) Security Concerns

| Risk | OWASP category (if applicable) | Evidence | Current mitigation | Gap |
|------|--------------------------------|----------|--------------------|-----|
| Per-controller auth instead of global guard | A01 Broken Access Control | `apps/api/src/modules/auth/auth.module.ts` | `requireUserId` call sites + `RequireAdminGuard` | No fail-closed global guard |
| Prompt injection via ingested content | A03 Injection | `packages/ai/src/wrap.ts`, `injection-scan.ts`; wired in jobs/market-brief/resume/dossier | `wrapUntrusted` + regex/heuristic scan + audit | LLM classifier pass and dedicated `llm_injection_log` table deferred; email path pending |
| Secrets could reach an external LLM | A02/A04 | `packages/ai/src/sensitivity-gate.ts`; `packages/shared/src/redact.ts` | Sensitivity gate scaffold + redaction pass | Gate is partial; employer-confidential default path needs end-to-end test |
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
| `apps/api/prisma/schema.prisma` | 55 models; migrations must be forward-safe | 17 commits / 90d | Named, idempotent, additive migrations; review |
| `packages/ai/src/index.ts` + prompt registry | Prompt/provider contract churn | 13 commits / 90d | Bump prompt versions; run evals |
| `pnpm-lock.yaml` | Dependency churn across 17 workspaces | 21 commits / 90d | Renovate + `pnpm install --frozen-lockfile` |
| `apps/api/package.json` | Repeated dependency adds | 14 commits / 90d | Keep versions aligned with worker |
| `infra/docker/docker-compose.yml` | Hardening/pins change frequently | 8 commits / 90d | Keep image-pin check green |
| `packages/shared/src/index.ts`, `packages/job-pipeline/src/index.ts` | Barrel exports are a wide blast radius | 6-7 commits / 90d | Add subpath exports rather than widening barrels |
| Plans themselves (`plan/COMPLETION_PLAN.md`, `HANDOFF.md`, `DEFERRED.md`) | Actively rewritten | 17/14/13 commits / 90d | Treat as source, but verify against code |

### 6) `[ASK USER]` Questions

1. **[ASK USER]** Is Career OS going OSS-public or staying personal-only? This blocks the LICENSE, `SECURITY.md` PGP key, install-doc polish, and several release blockers (`CONTRIBUTING.md`, `SECURITY.md`, `plan/PLAN.md:104-107`).
2. **[ASK USER]** What is the production TLS/reverse-proxy story — nginx + Let's Encrypt, Caddy, or a managed proxy? `infra/nginx/` does not exist yet (`docs/architecture.md` §2/§7).
3. **[ASK USER]** Which embedding model should ship as the real default — local `bge-small-en`, a hosted provider, or both? (`plan/PLAN.md:11` vs `packages/embeddings/src/local.ts`).
4. **[ASK USER]** Should the workspace converge on one Prisma major and one React major (resume-render is React 18, web/ui are React 19)? (`apps/api/package.json`, `apps/worker/package.json`, `packages/resume-render/package.json`).
5. **[ASK USER]** When should multi-user become a supported deployment (and therefore force `AppConfig` scoping + a global auth guard)? (`TODO(multitenant)` markers).
6. **[ASK USER]** Should the root ESLint chain be activated everywhere, given `apps/web` currently owns its own config? (`.eslintrc.cjs:10-18`).
7. **[ASK USER]** Where should encrypted backups ship (S3-compatible, Backblaze B2, or local path)? (`plan/PLAN.md:106`, `plan/security.md` item 8).
8. **[ASK USER]** Is the deferred GlitchTip/observability service intended for MVP or v1? It is specified but absent from compose (`plan/observability.md`).

### 7) Evidence

- Scan: `docs/codebase/.codebase-scan.txt` (TODO/FIXME/HACK list, HIGH-CHURN FILES, CODE METRICS, MONOREPO SIGNALS)
- Missing/candidate paths: shell inspection against `AGENTS.md` §5, `docs/dev-setup.md`, `docs/architecture.md` §2/§7
- Version drift: `apps/api/package.json`, `apps/worker/package.json`, `packages/resume-render/package.json`, `apps/web/package.json`
- Config contradictions: `pnpm-workspace.yaml:9-12` vs `package.json:46-51`; `.eslintrc.cjs:10-18`
- Security/safety gaps: `plan/security.md`, `plan/ai-safety.md`, `plan/DEFERRED.md`, `plan/PENDING_2026-10-02.md`
- High-churn: `docs/codebase/.codebase-scan.txt` (GIT RECENT COMMITS, HIGH-CHURN FILES)
