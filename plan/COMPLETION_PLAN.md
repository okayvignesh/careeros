# Career OS — Completion Plan
Generated: 2026-09-27
Sources: 4 audit reports in `plan/_audit_*.md` (do not delete these — every entry here traces back)

---

## 1. Executive summary

| Audit | Output | Total |
|---|---|---|
| `_audit_inventory.md` | Unchecked plan items across P0–P6 + cross-cutting | ~600 items |
| `_audit_security.md` | Vulnerabilities with file:line + fix | 2 Critical, 11 High, 9 Medium, 2 Low + 12 hardening opps |
| `_audit_drift.md` | Claimed-shipped vs actual code | 10 large services shipped without adjacent unit tests; no stubs; `packages/job-pipeline/src/index.ts` framing thin |
| `_audit_ba_qa.md` | BA acceptance criteria + QA test plans + product-completeness gaps | AC for 15 not-started features + 18 parked; 58 product gaps |

**Gate to "product complete"** (also §5 below):

1. Every Critical + High security finding closed with a regression test.
2. All 8 phases show `Done` in `plan/PLAN.md` with dates.
3. Every phase's Playwright golden flow green in CI.
4. `security.md` / `ai-safety.md` / `testing.md` / `observability.md` / `release-process.md` acceptance criteria checked.
5. 58 product-completeness gaps resolved or explicitly deferred with rationale.
6. Docs (install / user / admin / incident-response / threat-model) exist.
7. One-command backup + restore verified on a fresh VPS.
8. SBOM + signed images + signed commits enforced.

**Waves + sequencing.** A blocks B blocks C+D+E+F+G (parallel) blocks H.

| Wave | Focus | Blocks | Parallel-safe |
|---|---|---|---|
| **A** | Immediate hardening (Critical + High + cheap Med) | everything | limited (see §4) |
| **B** | Test backfill for shipped code | H | 10 workstreams, all parallel |
| **C** | Finish P0–P4 parked + unchecked | H | per-phase parallel |
| **D** | P3.5 desktop companion agent | H | fully parallel with C/E/F/G |
| **E** | P5 daily assistant (Slack + Gmail) | H | fully parallel with C/D/F/G |
| **F** | P6 controlled execution | H | fully parallel with C/D/E/G |
| **G** | Product-completeness gaps (58) | H | thematic streams, parallel |
| **H** | Release readiness (SBOM, sign, backup/restore CI, docs) | done | last |

---

## 2. Wave A — Immediate hardening (BLOCKS ALL FEATURE WORK)

Purpose: every Critical + High security finding ships before any new feature. Cheap Mediums included where the diff is trivial.

**Wave A status: 20 of 20 findings SHIPPED (all Critical + High + Medium + Low). Remediation batches Batch1/Batch2 shipped honesty fixes on top.** A-L2 folded into A-C1 `85a3afb` (normalization work); marker ticked 2026-09-28.

| ID | Sev | Category | File:line | What + fix | Maps to |
|---|---|---|---|---|---|
| ✅ A-C1 | C | RateLimit | `apps/api/src/main.ts:11-38` + `apps/api/src/modules/auth/auth.controller.ts:31-40` | SHIPPED `85a3afb`. No rate limiter anywhere. Add `@nestjs/throttler` + `ThrottlerStorageRedis`; global `{ttl:60000,limit:100}`, `POST /auth/sign-in` + `POST /setup/account` `{ttl:60000,limit:5}`; `LoginAttempt` table + exponential lockout | security.md item 4 |
| ✅ A-C2 | C | SSRF | `packages/shared/src/schemas/index.ts:16` + `packages/ai/src/providers/deepseek.ts:47` | SHIPPED `27e586f` + shape/dns split `1a86fbb` + tests `432b83c` + doc tick `fa5e10b`. `baseUrl` is unrestricted → any authed user can hit `169.254.169.254`, `minio:9000`, `postgres:5432`. Add `assertPublicUrl(url)`: HTTPS-in-prod, host allowlist, DNS-resolve + reject RFC1918/link-local/loopback, `redirect:'manual'`. Apply to `EmbeddingConfigSchema.externalBaseUrl` (schemas/index.ts:28) AND to the GitLab self-hosted `baseUrl` field introduced in C-P1.6. Default allowlist: `{deepseek, openai, anthropic, openrouter, localhost, ollama, api.github.com, gitlab.com}` + per-user opt-in host for self-hosted GitLab (see §6 open decision 7). | security.md item 6 |
| ✅ A-H1 | H | CSRF | `apps/api/src/modules/auth/session.service.ts:29` + `apps/api/src/main.ts:31-34` | SHIPPED `df8d246` + fetch-wrapper echo `4f113d8`. `SameSite=Lax` + `credentials:true` CORS + no CSRF token. Add `csrf-csrf` double-submit HMAC(SESSION_SECRET, sessionId); require `Sec-Fetch-Site: same-origin` on non-GET; flip `SameSite=Strict`. | security.md item 2 |
| ✅ A-H2 | H | Headers | `apps/api/src/main.ts:14-29` | SHIPPED `4926311` + prod-code extract `bd853a2`. Missing HSTS(2y+preload), Permissions-Policy, COOP, explicit Referrer-Policy; CSP still has `'unsafe-inline'` in `style-src`. Explicit helmet config; nonce-CSP; drop `unsafe-inline`. | security.md item 2 |
| ✅ A-H3 | H | AuthN | `apps/api/src/modules/auth/session.service.ts:8` + `apps/api/src/startup-check.ts:10-11` | SHIPPED `fbc4596`. `SECRET = process.env.SESSION_SECRET!` at module-load masks missing env; no revocation; 168h sealed cookie survives password change. Move read inside class after startup-check; store `sessionId` in sealed payload; `active_sessions` table with `iat`-invalidation on password reset. | security.md item 1 |
| ✅ A-H4 | H | Secrets | `packages/secrets/src/master-key.ts:22-28` | SHIPPED `189dbfc`. `loadMasterKey` null-pads short non-hex → silent entropy loss. Require 64 hex OR 44-char base64; delete null-pad branch; error: `openssl rand -hex 32`. | security.md item 1 |
| ✅ A-H5 | H | LLM safety | `packages/ai/src/providers/deepseek.ts:74-86` + every `chatStructured` caller | SHIPPED `b36b938` + scanAndWrap-merged-into-wrapUntrusted `2252337` + ai-safety tick `c75f195`. No `max_tokens`, no schema-fail retry, no injection-scan pre-pass. Add per-prompt `max_tokens` (default 4096); on `ZodError` retry once with error appended; create `packages/ai/injection-scan.ts` (regex + unicode-tag scan); gate untrusted content through it. | ai-safety.md items 2,5,9 |
| ✅ A-H6 | H | GH PAT scope | `apps/api/src/modules/integrations/github/github.service.ts:25-58` + `apps/worker/src/github-sync.ts:64` | SHIPPED `78d761d`. `GithubConnectSchema` accepts any 20-500 char token; no scope check; sync fires before validation. On `saveToken` inspect `x-oauth-scopes`; require ⊆ `{repo,read:user}`; block `admin:*`/`delete_repo`/`workflow`. | security.md item 6 + gap |
| ✅ A-H6b | H | GL PAT scope | to be created in C-P1.6: `apps/api/src/modules/integrations/gitlab/gitlab.service.ts` + `apps/worker/src/gitlab-sync.ts` | SHIPPED via C-P1.6b `409d8d2` + tests C-P1.6e `7c601fe`. Mirror of A-H6 for GitLab. On `saveToken` call `GET /api/v4/personal_access_tokens/self`, require `scopes` ⊆ `{read_api, read_user, read_repository}`; block `api`/`write_repository`/`sudo`; refuse `expires_at` in past; refuse revoked. Applies to public gitlab.com AND self-hosted enterprise instance. Optional OAuth client-secret path uses same scope gate on access-token issue. | security.md item 6 + gap |
| ✅ A-H7 | H | Deps | `apps/api/package.json:33,35` | SHIPPED `9d926a7`. `multer@1.4.5` (CVE-2022-24434, CVE-2024-4067) + `pdf-parse@1.1.1` (2018, transitive `pdfjs-dist` CVEs). Bump `multer@^2.0.0`; replace `pdf-parse` with direct `pdfjs-dist` or `unpdf`; add `pnpm audit --prod --audit-level=high` to CI. | security.md item 10 |
| ✅ A-H8 | H | Docker egress | `infra/docker/docker-compose.yml:106-123` | SHIPPED `ab9d05b`. Worker on the same `internal` bridge as db/redis; can reach `169.254.169.254` and any host. Split to `egress` network; add Squid egress proxy OR `network: none` + userland proxy per allowed host. | security.md item 6 |
| ✅ A-H9 | H | Docker defaults | `infra/docker/docker-compose.yml:8-10,53-54,72,78-79` | SHIPPED `9c5dff9`. `POSTGRES_PASSWORD: careeros`, `MINIO_ROOT_PASSWORD: careerosminio` defaults. Remove defaults; extend `startup-check.ts` to refuse boot on missing or weak values; `.env.example` only. | security.md item 1 |
| ✅ A-M1 | M | Cookie hardening | `apps/api/src/modules/auth/session.service.ts:29` | SHIPPED `c82479b` + dead-env-drop `de005ec` + cookie-literal-test `eb63466`. Cookie name env-overridable → no `__Host-` guarantee; `Secure` only in prod. Force `__Host-careeros_session` under TLS; drop `SESSION_COOKIE_NAME` env. | security.md item 2 |
| ✅ A-M2 | M | Setup enumeration | `apps/api/src/modules/setup/setup.controller.ts:40-56` | SHIPPED `8a9686b`. `GET /setup/state` reveals `hasUser`; race on `POST /setup/account`; P2002 leaks email exists. Wrap in `pg_advisory_xact_lock(1)`; return generic 409 on P2002. | security.md item 1 |
| ✅ A-M4 | M | Log leakage | `apps/api/src/modules/resume/resume.service.ts:117-124` + hallucination log | SHIPPED `c6c82bf`. Full resume text persisted to `llm_hallucination_log`. Mark `snippet` in `ENCRYPTED_FIELDS`; 30-day retention worker; log hashed offset only. | ai-safety.md item 9 + security item 5 |
| ✅ A-M5 | M | MinIO defaults + MIME | `apps/api/src/common/storage.service.ts:14-21` + `resume.service.ts` | SHIPPED `e2417e0`. Default access keys; client-provided mimetype trusted. Remove defaults; verify magic bytes server-side (`%PDF`, `PK\x03\x04`); per-user signed URLs. | security.md item 1 + item 6 |
| ✅ A-M6 | M | Multi-tenant creep | `apps/api/src/modules/usage/usage.controller.ts:107-136` | SHIPPED `c317d17`. `/me/*` routes mutate global `AppConfig`. Add `assert userCount()===1` guard + `TODO(multitenant):`; or scope AppConfig by userId. | security item 1 |
| ✅ A-M7 | M | Image pinning | `infra/docker/docker-compose.yml:5,23,36,49` | SHIPPED `96d366a` (image-pins CI job in `.github/workflows/pr.yml`). `quay.io/minio/minio:latest` floating; postgres/redis by tag not digest. Pin all to `@sha256:…`. **Note:** MinIO swapped to `bitnamilegacy/minio` per infra fix; upstream MinIO deprecation is external blocker task #22 (see HANDOFF.md). | security.md item 10 |
| ✅ A-M8 | M | Fail-open middleware | `apps/web/src/middleware.ts:26-28` | SHIPPED `b670dd9`. On API-down the middleware allows through. Redirect to `/service-unavailable` on network error; explicit deny-fail. | security.md item 1 |
| ✅ A-M9 | M | Per-user LLM burst cap | `apps/api/src/modules/usage/usage.service.ts` + every `tryLoadProvider` caller | SHIPPED `841861a`. `assertCallAllowed` only checks budget. Add `p-limit(2)` per user per LLM call site (single-user OK today; multi-user-ready). | security item 4 + ai-safety item 9 |
| ✅ A-L1 | L | Error leakage | `packages/ai/src/providers/deepseek.ts:231` | SHIPPED `b38c5c0`. Upstream error string re-thrown to client. Wrap as `LLM provider error`; log raw server-side. | — |
| ✅ A-L2 | L | Email normalization | `apps/api/src/modules/auth/auth.service.ts:189-191` | SHIPPED via A-C1 `85a3afb` (folded into normalization work). `normalizeEmail(email)` = `email.normalize('NFC').toLowerCase()`; applied at every user lookup (`createUser`, `verifyCredentials`, `verifyCredentialsWithLockout`). | — |

Wave A workstream AC (applied to every finding): **fix landed** + **regression test asserts the vuln is closed** + **finding appears once in `audit_log`** + **maps back to a security.md checkbox that gets ticked**.

### Wave A also opens (spec-gap items with no code yet — treat as scaffolding, not deferrals)

- `SECURITY.md`, `SECURITY-INCIDENT.md`, PGP key, disclosure email (security items 9).
- `packages/rate-limit/` module — where the throttler config lives (item 4).
- CI: `pnpm audit`, CodeQL, Trivy, `gitleaks`, Renovate (item 10).
- Container hardening: non-root UID, read-only rootfs, cap-drop, seccomp default (item 10).

---

## 3. Wave map (B through H)

### Wave B — Test backfill for shipped code (closes drift audit)

One workstream per service. All parallel; each is a single-file addition.

**Wave B status: 11 of 11 streams SHIPPED. Remediation WaveB-fix-{1,2} shipped grading-test and rootDir fixups.**

| ID | Target service (file) | Lines | Test scope |
|---|---|---|---|
| ✅ B-1 | `apps/api/src/modules/assessments/assessments.service.ts` | 2029 | SHIPPED `b1c6628` (grading) + `dd3e5a9` (boss-battle) + `310718c` (next-task). Split into `.grading.test.ts`, `.boss-battle.test.ts`, `.next-task.test.ts`. Timer/milestone/expiry deterministic |
| ✅ B-2 | Boss-battle server-authoritative timer path in B-1 | — | SHIPPED as part of B-1b `dd3e5a9`. Explicit: `expiresAt = startedAt + duration_s*1000` invariant; expiry transitions to `expired` even if client clock lies |
| ✅ B-3 | `apps/api/src/modules/resume-variants/resume-variants.service.ts` | 430 | SHIPPED `65a582d`. Fact-check gate: `DroppedBullet` produced; "no verdict returned" branch drops; hallucination-guard branch |
| ✅ B-4 | `apps/api/src/modules/cover-letters/cover-letters.service.ts` | 372 | SHIPPED `7b187c5`. Grounded-generation contract; fact-refs on every claim |
| ✅ B-5 | `apps/api/src/modules/market-brief/market-brief.service.ts` | 259 | SHIPPED `cbacad2`. Stats → LLM synthesis contract; URL post-filter drops off-source links |
| ✅ B-6 | `apps/api/src/modules/integrations/github/github.service.ts` | 134 | SHIPPED `932c8a5`. MSW-mocked GitHub; happy path + rate-limit path + PAT-scope reject (delivers on A-H6 test) |
| ✅ B-7 | `apps/api/src/modules/skills/skills.service.ts` | 127 | SHIPPED `cabe290`. Aggregation math; state transitions |
| ✅ B-8 | `apps/api/src/modules/embeddings/embeddings.service.ts` | 87 | SHIPPED `395a3fe`. Encode → upsert → search round-trip against a stub embedder |
| ✅ B-9 | `packages/resume-render/src/index.ts` (`renderResumePdf`) | — | SHIPPED `09a0a67`. PDF byte snapshot + `pdf-parse` round-trip: text matches source model (also delivers on ATS-lint test) |
| ✅ B-10 | `packages/job-pipeline/src/index.ts` framing (currently 2 lines) | 2 | SHIPPED `b4fd58c` + `a5ec56f`. Move pipeline stage funcs from `jobs.service.ts` into the package; tests per stage (normalize / dedupe / freshness / verify) |
| ✅ B-11 | `apps/web/package.json` (Next.js + postcss chain) | — | SHIPPED `0ee6f25` + `10dac8f` + `345d80a` + `88c7b97` (bumped 14 → 15; later bumped again to Next 16.3.6 via Cgamma-next16). **Elevated from Wave A follow-up per user directive.** Bump `next@14.2.15` to latest stable that clears `pnpm audit --prod --audit-level=high` (12 high + 3 critical CVEs in Next chain today block A-H7's CI gate and Wave H release). Keep App Router, resolve `postcss@8.4.31` chain. Fix latent `exactOptionalPropertyTypes` errors in `KpiRow.tsx:39`, `ProviderForm.tsx:66`, `SignInForm.tsx:35,44` that block `apps/web` typecheck. Regression: `pnpm --filter @careeros/web build` + `pnpm --filter @careeros/web typecheck` + `pnpm audit --prod --audit-level=high` all clean. |

### Wave C — Finish in-progress phases (P0–P4 unchecked)

Groups by phase; top ≤8 workstreams each. Item refs cite `phase-N-*.md:line`.

**C-P0 (7 of 8 SHIPPED; C-P0.6 deferred)** — closes ~120 unchecked in `_audit_inventory.md#Phase 0`:
1. ✅ SHIPPED `d5dcd0b` (P0.1b) — `AIProvider` interface + registry + capability probe (lines 64–68). Enables Wave A retry logic reuse.
2. ✅ SHIPPED `8a18278` + `4ac3959` + `cdd0d37` — Prompt registry: `packages/ai/prompts/` scaffold + SHA-256 hash-log + CI version-bump gate (78–83).
3. ✅ SHIPPED `f51f646` + `aac56b0` — `packages/ai/sensitivity-gate.ts` full impl + per-call opt-in <5 min re-auth (86–90).
4. ✅ SHIPPED `5127ebb` + `c8b978f` + `f65c779` + `860247d` + `d8a692d` — Testing infra: Testcontainers + Playwright storageState + `@axe-core/playwright` + `msw` + `fast-check` + `pnpm test:*` targets (131–139).
5. ✅ SHIPPED `6ed45a9` + `0e5b47b` + `1cbd42e` + `66a2d32` — GitHub Actions: `pr.yml`, `restore-test.yml`, `nightly-evals.yml`, `tag-release.yml` (140–143). Blocks Wave H.
6. DEFERRED — First-run failure recovery + Playwright golden flow end-to-end (150). Closes G-UX-1. (Web-owned surface; wait on parallel session or dispatch when they release.)
7. ✅ SHIPPED `34f2b9b` + `8daf48d` + `14ff0bd` + `d44a60b` — Passkey / WebAuthn (`@simplewebauthn/*`, register/login/revoke + recovery codes) (217–223 + security.md 96–102).
8. ✅ SHIPPED `d57b44b` + `4197789` + `f89d134` — `scripts/backup.sh` + `scripts/restore.sh` + `age` encrypt + 7d/4w/12m retention + `docs/backup.md` (244–250). Enables Wave H CI restore.

**C-P1 (6 of 6 SHIPPED)** — ~30 unchecked + GitLab addition:
1. ✅ SHIPPED `1b08cda` + `e2621fe` + `c83b55f` — Slice 2b commit-ingest: tree-sitter, framework detection, contributor filter, file-level evidence, AI-assistance heuristic (48–58). Applies to BOTH GitHub and GitLab repos (see C-P1.6) — write ingest layer source-agnostic behind a `CodeHost` interface.
2. ✅ SHIPPED `635e8ab` + `1cf6b4b` + `ef9ae94` — `learning_priority` formula end-to-end (36 + 41 + 149) — depends on P3 market data (C-P3.1).
3. ✅ SHIPPED `a1bce36` + `3ba64f4` + `f4396ca` — ESCO seed (21) + master fact base schema (63–65).
4. ✅ SHIPPED `e71f53f` + `75747af` + `848e027` — `packages/ai/evals/skill-extract/` 20+ fixtures (171) + priority-formula tests (149).
5. ✅ SHIPPED `653c46c` + `e099c0c` + `39cf678` + `fcf76b4` + `7e15bf7` — `pg_dump` opacity test (188); Prisma 6 `$extends` migration.
6. ✅ SHIPPED `253f667` + `409d8d2` + `c63e29d` + `7c601fe` — **GitLab integration (public gitlab.com + self-hosted enterprise)**. New module `apps/api/src/modules/integrations/gitlab/`, worker `apps/worker/src/gitlab-sync.ts`, package boundary via `CodeHost` interface in `packages/shared/src/code-host.ts` (GitHub refactors to implement it, GitLab is second impl). Scope per source:
   - Auth: PAT (default) + OAuth2 (optional) + self-hosted `baseUrl` field (validated via A-C2 `assertPublicUrl` with per-user opt-in host allowlist).
   - Ingest surfaces: projects, branches, commits, merge-requests + reviews, pipelines + jobs (CI runs → evidence for CI/CD skill), issues (as optional evidence source, opt-in).
   - Rate limits: honor GitLab response headers `RateLimit-Remaining` / `RateLimit-Reset`; exponential backoff shared with GitHub client via `packages/shared/retry.ts`.
   - Secrets: PAT + OAuth client secret encrypted-at-rest via `packages/secrets` (same path as GitHub PAT).
   - Egress: self-hosted host must be in per-user allowlist; blocked in `network: internal` mode until A-H8 egress isolation ships.
   - UI: Settings → Integrations gets a "GitLab" panel (public + self-hosted toggle). `frontend-design` agent leads.
   - Tests: MSW-mocked gitlab.com fixtures + one self-hosted fixture with a non-standard host; PAT-scope reject test (delivers A-H6b regression); SSRF regression test asserts self-hosted `baseUrl=http://169.254.169.254` is refused (delivers A-C2 regression for the GitLab path); 10+ eval fixtures for MR-review skill extraction.
   - Sensitivity: employer-confidential repos default `redact`; user must explicitly opt-in per project.

**C-P2 (6 of 8 SHIPPED; C-P2.4 build-consumer wire TODO + C-P2.5 verbal/multi-turn deferred)** — ~55 unchecked:
1. ✅ SHIPPED `2b3c2bf` + `78ae69a` + `a460f95` — `packages/sandbox` — Docker-per-run per language (29–37); N=2 pool; kill-switch `POST /admin/sandbox/pause` (38).
2. ✅ SHIPPED `12cf32f` + `7412833` — Sandbox security suite (145–150): memory bomb, network, fork bomb, wall clock, fs escape.
3. ✅ SHIPPED `c727a1e` / `d7ecd14` + `898f283` — Monaco editor in `packages/ui` + drafts (42–47); language auto-detect.
4. DEFERRED (`751307e` WaveC-alpha-fix-2 leaves TODO in packages/sandbox consumer wire) — Build/code assessment type + streamed test panel (67–70).
5. DEFERRED — System-design + build type + verbal defense (`whisper.cpp` local) + mock-interview multi-turn (77–98).
6. ✅ SHIPPED `f500d3f` + `39cf678` (P2.6b) actually `39e0bf4` + `b18e90d` — Quest generator + prereq graph (111–115) — depends on C-P1.2.
7. ✅ SHIPPED `7b830f6` + `e02dcac` + `7971f78` + `3817aa7` + `c3ee476` — Question corpus expansion: 2nd + 3rd adapters, weekly cron, embedding-cosine dedupe (184–211).
8. ✅ SHIPPED `efb6901` + `9b0ecb4` — Agent registry + orchestrator (171–177); eval sets (178).

**C-P3 (8 of 8 SHIPPED)** — ~65 unchecked:
1. ✅ SHIPPED `71add8f` + `6a527e0` + `a652a89` — Adapters: Ashby, Greenhouse, Adzuna, Arbeitnow (23–29); JSearch / Serpapi optional (32–33).
2. ✅ SHIPPED `78c0c9d` + `eed62d9` + `d3ac77b` + `2d75721` + `9fab7e3` — Verification stage + trust-order merge (63,79–82); `job_reject_log` UI (74–76).
3. ✅ SHIPPED `ef2dc5c` + `523b922` + `fea8848` — Seniority + role + comp classifier; FX normalization (100–108).
4. ✅ SHIPPED `feb251a` + `4aa8357` + `162be21` + `3c5fcdf` — Trend definitions + weekly cron + "what changed" diff (111–119).
5. ✅ SHIPPED `49e8393` + `1ddd705` — Screens 33/34/56 (126–130). (Screen 34 shipped via 33-overview + 56-providers combo.)
6. ✅ SHIPPED `5d19b79` + `03a5ebb` + `ec4af44` — Contract tests per adapter + weekly drift PR (154–156); eval sets (159–161).
7. ✅ SHIPPED `1a2551e` + `8d7192a` + `8e9b15e` + `55657ed` — `injection-scan` + `wrapUntrusted` on job descriptions + engineering blog chunks (183–193).
8. ✅ SHIPPED `24f436b` — Admin routes actually admin-gated (`requireAdmin` guard) + N+1 fix in `JobsService.sync` + match-score pagination fix (200–202). (N+1 + pagination fixes still deferred as debt notes in phase-3 file.)

**C-P4 (6 of 8 SHIPPED; C-P4.3 diff UI + C-P4.5/C-P4.6 web screens deferred)** — ~65 unchecked:
1. ✅ SHIPPED `809b9a4` + `61dc045` — Match scorer + readiness + gap report + explanations (22–33).
2. ✅ SHIPPED `519ef56` + `8ae9d20` + `35c8079` — DOCX renderer + `dense-tech`/`classic`/`modern-minimal` templates (45,47); unified `ResumeDoc` shape (46).
3. DEFERRED — Resume + cover-letter version diff UI (63–65,72,73) via `diff-match-patch`.
4. ✅ SHIPPED `8ca18ef` + `d7ed1e5` — Company dossier pipeline (78–95): identity → tech signals → reviews → interviews → recent events → synthesis.
5. DEFERRED (web-owned) — Application detail + timeline (108); Kanban board deferred but state chips must stay.
6. DEFERRED (web-owned) — Screens 36–44 (120–127).
7. ✅ SHIPPED `70df867` + `619ed3a` + `d24f62e` + `e482d1b` + `db913d5` — Fact-check gate on every generative surface (171–175); eval sets (147–151).
8. ✅ SHIPPED `c3e160a` + `86fa931` + `14b1d9b` + `16bac7d` — Metrics + logs per phase-4:182–183.

### Wave D — P3.5 desktop companion agent (new phase)

~55 unchecked in `_audit_inventory.md#Phase 3.5`. BA acceptance criteria in `_audit_ba_qa.md` §P3.5.

**Wave D status: 3 of 8 workstreams SHIPPED (D.1, D.2, D.5). Web + Electron surface + packaging + ops deferred.**

Workstreams:
1. ✅ SHIPPED `4212b78` + `85d9ebd` + `074c57b` + `58191c6` + `9537bbb` — `packages/browser-agent`: pacing, kill-switch, allowlist registry, task Zod schema (34).
2. ✅ SHIPPED `7e4957e` + `7f2a3b4` + `64dc1e0` + `4563b4b` — Migrations + APIs: `agent_devices`, `agent_tasks`, pair start/complete/refresh/revoke, WSS `/agent/ws`, `/agent/tasks/:id/result` (37–45).
3. NOT STARTED (web-owned) — Web downloads page + Settings→Devices (48–50).
4. NOT STARTED — Electron scaffold: main/renderer, tray, pairing window, `keytar`, `wss-client`, `task-runner` (53–62).
5. ✅ SHIPPED `7537f04` + `09726fa` + `b964eee` + `13ab751` — `scripts/linkedin-discover.ts` first script + fixture-based tests + selector-health probe (59,87–91).
6. NOT STARTED — Packaging: `electron-builder` (dmg/nsis/AppImage) + tag CI + `electron-updater` (65–68).
7. ✅ SHIPPED via D.2 (verified 2026-09-28) — Auth: JWT scope `agent:*` (agent.service.ts:21,214), refresh rotation (agent.service.ts:290-296 replaces old row in same tx), pairing rate limit 5/hr/IP on `pair/complete` (agent.controller.ts:80) + 3/min on `pair/start` (agent.controller.ts:49), agent version reporting on WSS connect (agent.gateway.ts:52-58) + on `pair/complete` (agent.service.ts:117). All 35 agent tests green.
8. NOT STARTED — Ops: corporate-proxy config, screenshot cleanup 30d, log rotation 14d (116–118).

### Wave E — P5 daily assistant (new phase)

~65 unchecked in `_audit_inventory.md#Phase 5`. AC in `_audit_ba_qa.md` §P5.

**Wave E status: 3 of 9 workstreams SHIPPED (E.2 Slack runtime, E.4 Gmail runtime, E.6 email parsers + ingest). Manifest/install-flow, daily-brief, classifier, fuzzy match/triage, messaging channel deferred.**

Workstreams:
1. NOT STARTED (partially covered by E.2d docs `bd2c82b`) — Slack app manifest + install flow + docs (25–28).
2. ✅ SHIPPED `8ac1e41` + `74713a4` + `ec15f9c` + `bd2c82b` — Slack Events API: signing, replay-protection ±5 min, `event_id` dedupe, slash commands `/quiz /jobs /approve /review /brief /pause /resume`, Block Kit builder, interactive buttons (31–38).
3. NOT STARTED — Daily-brief composer + BullMQ tz-aware scheduler + `/brief --snooze N` + opt-out (41–43,91–95).
4. ✅ SHIPPED `9b69468` + `a180dee` + `8066c9b` + `f45a39b` — Gmail Pub/Sub push + `history.list` diff + watch renewal cron + idempotency + encrypted storage (48–62).
5. NOT STARTED — Email classifier (9 classes, two-stage heuristic + LLM) + eval set per class 30+ (65–68,137).
6. ✅ SHIPPED `e59ef71` + `7f23899` + `687c73e` + `c9218b6` — Email parsers `packages/email-parsers/{linkedin,indeed,naukri}.ts` + sender allowlist + golden evals 10+ per platform (72–79,138). Also folds in email-ingest service + queue consumer.
7. NOT STARTED — Email→application fuzzy match with confidence bands + `email_application_links` + inbox-triage screen 50 (83–87,108–115).
8. PARTIALLY SHIPPED via E.6e `c9218b6` — Injection defense: `wrapUntrusted("email")` on every body + `injection-scan` on every incoming email + `SUSPECTED_INJECTION` triage flag (155–162).
9. NOT STARTED — `packages/messaging/Channel` interface + Slack + web + stubs for WhatsApp/Discord (99–103); per-event preferences (104).

### Wave F — P6 controlled execution (new phase)

~85 unchecked in `_audit_inventory.md#Phase 6`. AC in `_audit_ba_qa.md` §P6.

**Wave F status: 2 of 11 workstreams SHIPPED (F.1 approval queue, F.6 audit-log immutability). F.7 partially shipped via C-P0.5b + C-P0.8. F.11 partially shipped via C-P3.8. ATS submit, form-fill, interview prep, outreach, data portability, advanced dashboard, and screens deferred.**

Workstreams:
1. ✅ SHIPPED `74e3a4c` + `631a997` + `c7e2c25` + `4326e3d` — Approval queue + state machine (`pending/approved/sent/failed/cancelled`) + diff preview + bulk-threshold + fresh-re-auth (21–23,101–104).
2. NOT STARTED — ATS submit adapters: Ashby, Greenhouse, idempotency, backoff, response parsing, auto-move to `applied` (26–32,144–145).
3. NOT STARTED — Agent form-fill: allowlist YAML per domain + dry-run then live + scripts `{ashby,greenhouse,linkedin-easy,indeed-easy,naukri,generic}-apply` + selector-health cron + selector-broken fallback (35–43,134,153).
4. NOT STARTED — Interview prep + talk-track: per-job prep plan, grounded topics, talk-tracks with fact-check gate + verbal-defense reuse (47–52,148–149).
5. NOT STARTED — Outreach composer: templates versioned + per-industry variants + send-timing + Gmail drafts + reply tracking (55–61,150).
6. ✅ SHIPPED `411556e` + `d99d0a4` + `b319dee` + `eb50acd` — Audit log: append-only DDL grants + 1y retention + read-only replica + append-only unit test (72–76,137).
7. PARTIALLY SHIPPED via C-P0.5b `0e5b47b` + C-P0.8 (`d57b44b` + `4197789` + `f89d134`) — Backup + restore CI: nightly + off-site destination + `age` byte-inspection + RPO24/RTO2 (79–96,141). (Off-site destination + RPO/RTO docs + byte-inspection assertion still deferred.)
8. NOT STARTED — Data portability: `POST /me/export` + `POST /me/delete` + row-count parity tests (85–90,157–158).
9. NOT STARTED — Advanced Usage & Costs dashboard: cost projection, cache-hit, latency histograms, error-rate, model-compare, eval-pass, CSV/JSON export, alert config, anomaly, thumbs-down feedback loop (107–118).
10. NOT STARTED (web-owned) — Screens 45/46/47/48/57/59/60/63/64 (121–129).
11. PARTIALLY SHIPPED — `requireAdmin` guard via C-P3.8 `24f436b`; F.11a `bfb8271` shipped Gmail Pub/Sub push webhook 300/min per-IP cap. Slack webhook rate-limits (events/interactive/commands/oauth) + per-integration OAuth scope drop-unused audit deferred until parallel session releases the slack module.

### Wave G — Product completeness gaps (58 items grouped)

Source: `_audit_ba_qa.md#Product completeness gaps` (58 items). Grouped for delegation:

| Stream | Gaps rolled up | Owner phase |
|---|---|---|
| **G-UX-1** States retrofit | Empty/loading/error trio matrix; skeleton-vs-orb policy; global error boundary + `error.tsx`/`global-error.tsx`; 404/401/403 pages; offline banner; first-run wizard resume flow | P0 |
| **G-UX-2** Onboarding + help | Product tour post-signin; help palette (`?` key); tooltip layer | P4 |
| **G-A11y** Accessibility | Per-screen WCAG-AA checklist; SR-only labels on icon buttons; focus mgmt on route change; keyboard shortcuts sheet | every phase |
| **G-Data** Data ergonomics | Applications CSV; resume JSON; LinkedIn/Indeed CSV import; per-domain quick export | P4/P6 |
| **G-Ops** Ops UX | Backup destination decision; `age` key rotation + recovery-key UX; quarterly operator restore drill; monitoring alert delivery UI hooks; uptime reco + Loki/Vector docs | P6 |
| **G-Release** In-app release | New-version banner; upgrade-history page; post-upgrade smoke widget | P6 |
| **G-Cost** Cost/rate-limit UX | 429 banner "you've used 87% today, resets HH:MM"; pre-flight cost card on heavy ops; provider-fallback UX; degraded-provider banner; per-artifact cost + tokens | P1/P4/P6 |
| **G-i18n** i18n + locale | Confirm English-only for v1.0; timezone display consistency + toggle; currency per-user preference for comp | P0/P3/P4 |
| **G-Docs** Docs | `docs/install.md`, `docs/user-manual.md`, `docs/runbook.md`, `docs/incident-response.md`, `docs/threat-model-operator.md`, `docs/verify.md`, `CHANGELOG.md` pre-1.0, `postmortem-template.md` | P0 + P6 |
| **G-Legal** Legal + license | `LICENSE` (missing), `NOTICES` for AGPL/MIT/Apache; privacy notice + terms + cookie disclosure | P0/P6 |
| **G-Auth** Session + roles | Screen 59 AC: list + revoke sessions; passkey recovery; `requireAdmin` guard | P0/P6 |
| **G-Notif** Notifications | In-app toast + notification center for async completions; quiet hours; per-feature kill switches | P5/P6 |
| **G-Feedback** Feedback loop | Thumbs-up/down on every generated artifact → eval set + regression counter | P1/P4/P6 |
| **G-Test** Test debt | Golden-flow wizard test; Playwright storage-state fixture; 20+ eval fixtures for every critical prompt; PII-redaction-in-GlitchTip positive test; time-to-first-value manual QA gate | P0/P1 |
| **G-Meta** Design system | Design-system baseline screenshot set to prevent cross-phase drift | P0 |

### Wave H — Release readiness

1. GitHub Releases + `SHA256SUMS` + `cosign` keyless OIDC + Syft CycloneDX SBOM per image (phase-0-install:257–262).
2. `docs/verify.md` with `cosign` steps.
3. Sigstore `gitsign` + branch protection: signed commits required on `main`.
4. Weekly `.github/workflows/restore-test.yml` restores latest backup on fresh volumes and asserts parity (blocked by C-P0.8 + F.7).
5. `.github/workflows/nightly-evals.yml` runs the full LLM eval suite + drift alert (blocked by every phase's evals in Wave C/D/E/F).
6. `docs/observability/alerts.md` with recommended set (approvals >24h, submissions failing >20%, backup missed, restore-test fail).
7. Renovate config, weekly PR cadence.
8. `CHANGELOG.md` first release entry; PLAN.md phase board flipped to `Done` per phase.

---

## 4. Per-workstream agent assignments

Legend:
- `implementer` — writes code
- `qa-verifier` — spawned after implementer per the iteration-verification rule; independently runs tests + acceptance checks
- `ba` — writes/updates AC before implementer starts (skipped where AC already in `_audit_ba_qa.md`)
- `frontend-design` — invoked for any UI-visible change per the Career OS UI revamp rule
- `security-review` — invoked on any change touching auth, secrets, LLM boundaries, egress, uploads, or admin routes

### Wave A parallelism

**Non-overlapping module clusters (safe to run concurrently):**

| Cluster | Findings | Files touched |
|---|---|---|
| Cluster A-auth | A-C1, A-H1, A-H2, A-H3, A-M1, A-M2 | `apps/api/src/main.ts`, `modules/auth/*`, `modules/setup/*`, `startup-check.ts` |
| Cluster A-llm | A-C2, A-H5, A-L1 | `packages/shared/schemas/`, `packages/ai/`, every `*/tryLoadProvider` call site (read-only add of `assertPublicUrl`) |
| Cluster A-secrets | A-H4, A-M4 | `packages/secrets/`, `apps/api/src/common/hallucination-log.ts`, `prisma.service.ts` (ENCRYPTED_FIELDS) |
| Cluster A-code-hosts | A-H6, A-H6b | `apps/api/src/modules/integrations/github/*`, `apps/worker/src/github-sync.ts`, and the new `integrations/gitlab/*` + `gitlab-sync.ts` created in C-P1.6 (A-H6b lands with C-P1.6, not in Wave A directly — Wave A ships A-H6 alone; A-H6b tracked as C-P1.6 acceptance criterion so no split PR is needed) |
| Cluster A-deps | A-H7 | `apps/api/package.json`, `resume.service.ts` (pdf-parse call site) |
| Cluster A-infra | A-H8, A-H9, A-M7 | `infra/docker/*`, `startup-check.ts` (weak-cred assertion) |
| Cluster A-storage | A-M5 | `apps/api/src/common/storage.service.ts`, `resume.service.ts` upload path |
| Cluster A-frontend | A-M8 | `apps/web/src/middleware.ts` |
| Cluster A-usage | A-M6, A-M9, A-L2 | `apps/api/src/modules/usage/*`, `modules/auth/auth.service.ts` |

**Recommended concurrency: 9 implementer agents run in parallel** (one per cluster). Each cluster spawns its `qa-verifier` on completion, and `security-review` at the end of the wave against the full diff. `auth.service.ts` appears in Cluster A-auth (A-H1/H3) and Cluster A-usage (A-L2) — sequence those two clusters or split A-L2 into its own PR after A-auth lands.

### Wave B parallelism

All 10 workstreams are independent (each adds one adjacent test file next to a service that already exists). **10 implementer agents in parallel**, one `qa-verifier` after each to assert new tests fail against a deliberately-broken version of the service (mutation smoke).

### Waves C–G parallelism

Cross-phase parallel is safe. Within a phase, keep workstreams parallel where they touch different modules; serialize where they don't (e.g., C-P2.1 sandbox blocks C-P2.4 build type). Every UI workstream spawns `frontend-design` before implementer starts (produces layout + tokens) and `qa-verifier` after (runs `checkA11y` + visual regression).

Per-workstream assignment table (abbreviated — full expansion in workstream tickets; agent types per row):

| Wave | Workstream | Agents |
|---|---|---|
| C-P0 | 1–8 | implementer + qa-verifier all; frontend-design on 6; security-review on 3 + 7 |
| C-P1 | 1–5 | implementer + qa-verifier all; security-review on 1 (commit ingest — sensitivity gate) |
| C-P2 | 1–8 | implementer + qa-verifier all; frontend-design on 3–5; security-review on 1 + 2 (sandbox) |
| C-P3 | 1–8 | implementer + qa-verifier all; frontend-design on 5; security-review on 7 + 8 |
| C-P4 | 1–8 | implementer + qa-verifier all; frontend-design on 5 + 6; security-review on 4 (dossier fetcher — SSRF adjacent) |
| D | 1–8 | implementer + qa-verifier all; frontend-design on 3; security-review on 7 (JWT/pairing) |
| E | 1–9 | implementer + qa-verifier all; frontend-design on 3 + 7 (inbox); security-review on 2 (Slack signing) + 4 (Pub/Sub) + 8 (injection) |
| F | 1–11 | implementer + qa-verifier all; frontend-design on 1 + 4 + 9 + 10; security-review on 3 (form-fill) + 6 (audit-log DDL) + 8 (delete-all) + 11 (admin guard) |
| G | UX-1/UX-2/A11y/Notif | frontend-design leads; implementer + qa-verifier per stream |
| G | Data/Ops/Release/Cost/i18n/Docs/Legal/Auth/Feedback/Test/Meta | implementer + qa-verifier; ba on Docs + Legal |
| H | 1–8 | implementer + qa-verifier; security-review on 1 + 3 (signing chain) |

`ba` is only invoked where AC weren't already produced in `_audit_ba_qa.md` — i.e., novel product features surfaced during implementation, and legal/docs.

---

## 5. Definition of 'product complete' (exit checklist)

- [ ] Every Wave A finding closed with regression test; `_audit_security.md` shows all Critical + High + cheap Med `Resolved` (link to commit + test).
- [ ] All 8 phases in `plan/PLAN.md` show `Done` with a date.
- [ ] Every phase's Playwright golden flow is green in CI (PR + main).
- [ ] `plan/security.md` all acceptance criteria checked (Wave A + C-P0.7 + H).
- [ ] `plan/ai-safety.md` all acceptance criteria checked (Wave A-H5 + injection scan + eval nights).
- [ ] `plan/testing.md` all acceptance criteria checked (Wave B + phase evals).
- [ ] `plan/observability.md` phase coverage checked (per-phase metrics + logs in Waves C–F).
- [ ] `plan/release-process.md` per-release checklist runnable (Wave H).
- [ ] 58 product-completeness gaps resolved OR explicitly deferred with rationale committed in `plan/DEFERRED.md`.
- [ ] Docs exist: `README.md`, `docs/install.md`, `docs/user-manual.md`, `docs/runbook.md`, `docs/incident-response.md`, `docs/threat-model-operator.md`, `docs/verify.md`, `docs/backup.md`, `docs/egress.md`, `docs/slack-setup.md`, `docs/gmail-setup.md`, `CHANGELOG.md`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `LICENSE`, `NOTICES`.
- [ ] One-command backup + restore verified on a fresh VPS (manual once; CI weekly).
- [ ] SBOM (Syft CycloneDX) attached to every release; every image signed with `cosign`; every commit on `main` signed with `gitsign`; branch protection enforced.

---

## 6. Open decisions the user must make BEFORE Wave A ships

1. **Product final name** — working "Career OS". Affects `SECURITY.md`, image names, docs. Default: keep "Career OS".
2. **OSS-public vs personal-only** — determines whether `LICENSE`, `NOTICES`, `SECURITY.md` publish path, privacy/terms, and CI cadence matter as public commitments. Default: personal-only for now, keep everything ready for OSS flip.
3. **VPS backup destination** — S3 / Backblaze B2 / rsync-to-laptop? Blocks F.7 and H.4. Default: Backblaze B2 (cheap, S3-compatible).
4. **Domain + TLS provider** — nginx + Let's Encrypt (assumed) or Caddy? Blocks C-P0 nginx config + H. Default: nginx + certbot.
5. **Mobile companion** — remains parked per `PLAN.md` open questions? Default: yes, parked.
6. **UX trade-off checks for Wave A fixes:**
   - A-H1 CSRF: flipping `SameSite=Strict` breaks nothing today (no cross-domain wizard). Confirm.
   - A-C2 SSRF allowlist: locks `baseUrl` to `{deepseek, openai, anthropic, openrouter, localhost, ollama, api.github.com, gitlab.com}` — is there any provider you want to use that isn't on that list? Add now.
   - A-M1 `__Host-` cookie: drops the `SESSION_COOKIE_NAME` env override. Any deploy using a custom name? Default: none.
   - A-H8 egress isolation: Squid proxy is simplest; alternative is per-service `network: none` + userland proxy (more work). Default: Squid.
7. **GitLab self-hosted host** (new): what is the FQDN of your enterprise/organisation self-hosted GitLab? This gets added to the per-user allowlist enforced by `assertPublicUrl`. If more than one instance, list them all. Blocks C-P1.6 self-hosted variant only; public gitlab.com works without this answer. Default: none until you tell me.
8. **GitLab auth mode** (new): PAT-only (simplest, ships C-P1.6 unblocked) or PAT + OAuth2 (requires registering an OAuth application on the self-hosted instance)? Default: PAT-only for v1.0, OAuth2 in a later slice.
9. **GitLab issues ingest** (new): include GitLab issues as evidence for skill extraction, or repos + MRs + pipelines only? Default: repos + MRs + pipelines only (issues add noise for candidate-twin use case).

Say "approve defaults" to lock all nine; else answer per-item.

---

## 7. Rough effort per wave (dev-day range, informational)

Estimates assume one solid implementer per stream + qa-verifier + reviews. Solo human calibration expected; parallel agents compress calendar, not effort.

| Wave | Streams | Effort (dev-days) | Calendar with N=9 parallel |
|---|---|---|---|
| A | 20 findings across 9 clusters | 12–18 | 2–3 days |
| B | 10 test-backfill streams | 8–12 | 1–2 days |
| C-P0 | 8 | 20–30 | 4–5 days |
| C-P1 | 5 | 12–20 | 3 days |
| C-P2 | 8 | 30–45 | 5–7 days |
| C-P3 | 8 | 25–35 | 4–5 days |
| C-P4 | 8 | 25–35 | 4–5 days |
| D | 8 | 30–45 | 5–7 days (Electron adds sequential OS-QA gates) |
| E | 9 | 25–35 | 4–5 days (Slack + Gmail app approval calendar-blocking) |
| F | 11 | 40–60 | 6–9 days |
| G | ~14 streams / 58 gaps | 20–30 | 3–5 days (a lot of these are 1–2h each) |
| H | 8 | 6–10 | 2 days |

**Total headline:** ~255–375 dev-days of raw work. With max-parallel agents + gated user reviews, calendar is on the order of ~40–60 working days end-to-end, dominated by the sequential gates: user reviews, OAuth verification calendars (Slack + Gmail), OS-QA gates (Electron on Mac/Windows/Linux), and the weekly restore-test CI needing at least one full week of runs before H flips.
