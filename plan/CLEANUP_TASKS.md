# Cleanup Tasks — Health Review Remediation

Source: the deep-scan review (architecture, security, implementation, Semgrep).
Branch: `cleanup/health-review-2026-10-02`. Base commit: `47be31a`.

## Coordination protocol (how this list is executed)

- **Master agent** = the main session. Owns this list, assigns work, runs the authoritative verification, commits per task, and never marks a task done without evidence.
- **Worker agents** = one focused sub-agent per task. Each gets exact files, acceptance criteria and a "no shortcuts" mandate: smallest correct change, no stubs/TODOs left behind, report the exact diff and how it was checked.
- **Verifier** = central, not delegated. Master rsyncs the working tree to an APFS copy (`$VERIFY`) and runs `pnpm typecheck`, `pnpm test`, `pnpm lint` (where applicable) plus Semgrep for security tasks. A read-only reviewer sub-agent re-checks the diff against the task's acceptance criteria.
- **Environment:** repo is on exFAT (no pnpm symlink store); toolchain runs in the APFS verify copy. `._*` AppleDouble files are cleaned before commits.
- **No task is "done" without:** acceptance criteria met, central verification green (or a written reason it cannot run), and no new TODO/stub introduced.

## Status legend

`TODO` · `IN PROGRESS` · `REVIEW` · `DONE` · `BLOCKED` · `DECISION` (needs user)

---

## Tier 1 — Build blockers, security and correctness

| ID | Task | Files | Acceptance criteria | Verification | Risk | Status |
|----|------|-------|---------------------|--------------|------|--------|
| T1 | Restore `packages/ui/src/motion.ts` (barrel re-exports it; ~82 web files import `@careeros/ui`) | `packages/ui/src/motion.ts`, `packages/ui/src/index.ts` | Barrel import resolves; every symbol re-exported exists; web typechecks | `pnpm typecheck` | Med | TODO |
| T5 | Set explicit GCM `authTagLength` | `packages/auth/src/session.ts`, `packages/secrets/src/encryption.ts` | `createDecipheriv` passes `{ authTagLength: 16 }`; round-trip tests pass | unit tests + Semgrep re-scan | Low | TODO |
| T7 | Advisory lock on `/auth/sign-up` (single-user race) | `apps/api/src/modules/auth/auth.controller.ts`, `auth.service.ts` | Concurrent sign-up serialized like `/setup/account`; generic conflict response | unit test + code review | Low | TODO |
| T10 | Slack OAuth `state` + session binding | `apps/api/src/modules/slack/slack.controller.ts`, `slack.service.ts` | Callback requires authenticated session + server-issued `state`; mismatch rejected | unit test | Med | TODO |
| T15 | Trusted client IP for lockout/audit | `apps/api/src/modules/auth/auth.controller.ts`, `agent.controller.ts`, recovery/passkey/me controllers | Uses `req.ip` behind configured trust proxy, not raw `x-forwarded-for` | unit test | Low | TODO |
| T8 | Harden worker + web containers | `infra/docker/Dockerfile.worker`, `Dockerfile.web`, `docker-compose.yml` | Non-root `USER`, `read_only`, `tmpfs`, `cap_drop: ALL`, `no-new-privileges` mirroring `api` | `docker compose config` + build | Med | TODO |
| T9 | Pin GitHub Actions to commit SHAs | `.github/workflows/*.yml` | No `uses: ...@vN|master|main`; all pinned to full SHAs (with version comment) | grep + Semgrep | Low | TODO |
| T4 | Add missing `apps/web/src/no-analytics-sdk.test.ts` | `apps/web/src/no-analytics-sdk.test.ts` | Direct-deps analytics guard test exists and passes | `pnpm test` | Low | TODO |
| T14 | `testStreaming` uses `safeFetch` (SSRF) | `packages/ai/src/providers/deepseek.ts` | No raw `fetch` in provider paths outside `safeFetch` | unit test | Low | TODO |
| T6 | Enforce Squid egress for app `fetch` (H1) | `apps/api/src/main.ts`, `apps/worker/src/main.ts`, `packages/shared/src/net/*`, `scripts/smoke/egress.sh` | Node global fetch routed through proxy/allowlist; smoke test exercises `fetch` | integration/static + re-scan | High | TODO |
| T11 | Align Prisma version across workspaces | `apps/worker/package.json`, `apps/api/package.json`, lockfile | One `@prisma/client` major; `pnpm install` clean; worker typechecks | `pnpm install` + typecheck | High | TODO |
| T12 | Resolve `pnpm.overrides` contradiction | `package.json`, `pnpm-workspace.yaml` | One documented location; comment matches reality; install has no WARN | `pnpm install` output | Low | TODO |
| T3 | Resolve missing referenced scripts | `scripts/dev-host.sh`, `scripts/seed-test.ts`, `infra/docker/docker-compose.host-dev.yml`, `package.json` | References resolve (implemented) or removed; no dangling refs | grep for refs + run | Med | TODO |

## Tier 2 — Architecture refactors (do after Tier 1 verification)

| ID | Task | Files | Acceptance criteria | Risk | Status |
|----|------|-------|---------------------|------|--------|
| A1 | Extract `packages/aggregator` (skill-state sync) | `apps/api/src/common/aggregate-skill.ts`, `apps/worker/src/aggregator.ts` | One implementation; both apps import it; tests green | Med | TODO |
| A2 | Extract `loadProviderForUser` helper | 7 services + `packages/ai` | One loader; sensitivity passed per call; tests green | Med | TODO |
| A3 | Unify job pipeline + single match scorer | `packages/job-pipeline`, `jobs.service.ts`, `matcher.service.ts`, `shared/match.ts` | List and detail return the same score; pipeline stages owned by the package | High | TODO |
| A4 | Extract `recordAttemptOutcome` | `assessments.service.ts` | One outcome path for all 7 assessment types; tests green | High | TODO |
| A5 | Worker `registerWorker` helper | `apps/worker/src/main.ts` | Boot is declarative; unknown-job path uniform | Low | TODO |
| A6 | Unify SensitivityGate | `packages/ai/src/sensitivity-gate.ts`, `apps/api/src/common/sensitivity-gate.service.ts` | One authoritative policy source | Med | TODO |
| A7 | Approvals dispatch fails loud | `approvals.service.ts` | Unhandled kind → audit + `markFailed`; ownership persisted | Med | TODO |
| A8 | Remove web fixture fallbacks | market-demand + search-providers components | Explicit unavailable state; no fabricated data | Low | TODO |

## Tier 3 — Tests and CI

| ID | Task | Acceptance criteria | Status |
|----|------|---------------------|--------|
| C1 | Web component/page test baseline | ≥1 render test for a shipped screen | TODO |
| C2 | Add Playwright + a11y + lint to CI | `pr.yml` runs e2e (or a smoke subset) + lint | TODO |
| C3 | Make nightly-evals and restore-test real | Workflows run the eval runner / restore round-trip, no placeholder exit 0 | TODO |
| C4 | Integration tests for critical paths | Pipeline/aggregator/provider-loader covered | TODO |

## Tier 4 — Documentation reconciliation

| ID | Task | Acceptance criteria | Status |
|----|------|---------------------|--------|
| D1 | Fix `plan/PLAN.md` status board | Matches `DEFERRED.md` + code | TODO |
| D2 | Fix `docs/dev-setup.md` commands | Every listed command exists | TODO |
| D3 | Update `AGENTS.md` layout/conventions | `packages/*`, rules match reality | TODO |
| D4 | Regenerate KB after fixes | `docs/codebase/*` + HTML + AI layer refreshed | TODO |
| D5 | Remove stale references | No dangling doc/file references | TODO |

## Tier 5 — Decisions required (blocking the listed tasks)

| ID | Decision | Blocks |
|----|----------|--------|
| U1 | Swagger: implement `/api/docs` or drop the claim? | T2 |
| U2 | Align Prisma + React majors (accept breaking churn)? | T11, drift cleanup |
| U3 | Activate the root ESLint chain everywhere? | C2, conventions enforcement |
| U4 | Is GlitchTip / nginx / whisper in scope for MVP? | deployment docs |
| U5 | OSS-public vs personal-only (LICENSE, SECURITY.md)? | release docs |
| U6 | **Amend non-negotiable rule #4 to permit Firecrawl / career-site crawling?** See Tier 6. The repo currently bans third-party scrapers outright ("Apify or similar is also out"). Owner sign-off + ToS/robots policy required. | F1-F10 |

---

## Tier 1b — Findings exposed by the toolchain baseline (new)

| ID | Task | Files | Acceptance criteria | Verification | Status |
|----|------|-------|---------------------|--------------|--------|
| T16 | Committed `pnpm-lock.yaml` is out of sync with `package.json` (root `@types/node` specifier) — `pnpm install --frozen-lockfile` fails | `pnpm-lock.yaml`, `package.json` | `pnpm install --frozen-lockfile` succeeds; lockfile matches manifests | `corepack pnpm install --frozen-lockfile` | TODO |
| T17 | `packages/resume-render` fails `tsc --noEmit` (React 18 vs hoisted React 19 `@types`; `Document/Page/View/Text cannot be used as a JSX component`) — a build blocker | `packages/resume-render/package.json`, `tsconfig.json`, `src/templates/*.tsx` | Package typechecks under the repo's strict config; rendering unchanged | `turbo run typecheck` | TODO |
| T18 | `apps/web` lint peer conflict: `eslint-config-next@16` requires `eslint >= 9`, repo has `8.57` | `apps/web/package.json`, lint config | Web lint runs without unmet-peer error | `pnpm --filter @careeros/web lint` | TODO |
| T19 | Workspace hygiene on the exFAT volume: `node_modules/`, `.turbo/`, `._*` AppleDouble files pollute the tree | `.gitignore`, working tree | No build artifacts or `._*` tracked; documented that deps must be installed on APFS | `git status --ignored` | TODO |
| T20 | `turbo run typecheck` never runs `prisma generate`, so a clean checkout fails with hundreds of phantom `Prisma.*` / implicit-any errors; Prisma client must be generated first | `apps/api/package.json`, `turbo.json`, CI `pr.yml` | `pnpm install && pnpm typecheck` succeeds from a clean clone (generate wired into the verify path) | clean-clone `pnpm typecheck` | TODO |
| T21 | `@careeros/ai` build fails: `providers/deepseek.ts:8` imports `assertPublicUrl`/`assertPublicUrlShape`/`safeFetch` from `@careeros/shared`, but the `./net` subpath is excluded from the barrel; plus `deepseek.ts:90` `void \| null` type error | `packages/ai/src/providers/deepseek.ts`, `packages/shared/src/index.ts` | `@careeros/ai` builds; SSRF guard still used; `testStreaming` uses `safeFetch` (folds in T14) | `pnpm --filter @careeros/ai build` | TODO |
| T22 | `apps/api` imports `@careeros/email-parsers` but does not declare it as a dependency → `TS2307` | `apps/api/package.json` | Module resolves; workspace dep + build order correct | api typecheck | TODO |
| T23 | `exactOptionalPropertyTypes` violations across api: `approvals.controller.ts:43,67`, `slack.controller.ts:111`, `slack.block-kit.ts:60`, `seed/esco.ts:80`, plus test files (`jobs`, `market-brief`, `esco`) | apps/api modules/tests | No `exactOptionalPropertyTypes` errors; behavior unchanged | api typecheck | TODO |
| T24 | `packages/job-pipeline` build fails (investigate root cause) | `packages/job-pipeline/**` | Package builds clean | `pnpm --filter @careeros/job-pipeline build` | TODO |
| T25 | Worker typecheck errors (test typing: `audit-log-retention.test.ts`, `gitlab-sync.test.ts`; `interview-prep.service.test.ts` Buffer) | apps/worker tests, apps/api test | Worker + api tests typecheck | turbo typecheck | DONE |
| T26 | Pre-existing date-window test failures in `apps/api/src/modules/market-brief/market-brief.service.test.ts` (expected `newCount` 5, got 1; fixtures are relative to "today" = 2026-10-02) | market-brief test + fixtures | Test is time-independent (frozen clock or explicit dates) and passes | `pnpm --filter @careeros/api test` | TODO |

## Tier 6 — Job acquisition expansion: Firecrawl + Workday + other sources

Goal: let Career OS **search and crawl job listings online** and ingest full job details tailored to the candidate, via the Firecrawl API key, plus first-party ATS/career-site adapters (Workday and others). Everything still flows through `packages/job-pipeline` and the egress allowlist.

> **Policy conflict (U6, blocking):** `AGENTS.md` §3.4 and §15 currently forbid server-side scraping *and* explicitly reject outsourcing it to third parties. Firecrawl is a third-party scraping service. Implementing this requires the owner to amend rule #4. Recommended scope: permit Firecrawl/HTTP crawling of **public company career sites and ATS boards** (Workday, Lever, SmartRecruiters, Workable, iCIMS, SuccessFactors) with `robots.txt`/ToS respect, rate limits and attribution; **keep** the ban on LinkedIn/Indeed/Naukri/Glassdoor except via authorized partner APIs or the user's own desktop agent.

| ID | Task | Files | Acceptance criteria | Risk | Status |
|----|------|-------|---------------------|------|--------|
| F1 | Firecrawl client (search / scrape / crawl) | new `packages/firecrawl/` (or `packages/job-pipeline/src/adapters/firecrawl/`) | `search()`, `scrape()`, `crawl()` use `safeFetch` + Zod-validated responses; typed errors; retry/backoff; unit + `msw` tests | Med | TODO |
| F2 | `FIRECRAWL_API_KEY` config + encrypted at rest | `.env.example`, `apps/api/src/startup-check.ts` (optional-key), secrets store | Key never logged; stored encrypted; surfaced in settings; missing key degrades gracefully | Med | TODO |
| F3 | Egress allowlist for Firecrawl | `infra/docker/squid/squid.conf` | `api.firecrawl.dev` (+ crawl target policy) allowed; depends on T6 fix so the allowlist actually applies to `fetch` | Med | TODO |
| F4 | Firecrawl job-source adapter | `packages/job-pipeline/src/adapters/firecrawl/`, adapter registry | Search/scrape results map to `RawJob`; trust tier `DISCOVERED`/`UNVERIFIED`; fixtures + `*.contract.test.ts` | Med | TODO |
| F5 | Workday adapter (public career sites) | `packages/job-pipeline/src/adapters/workday/` | Tenant/site discovery → jobs list → job detail via `safeFetch`; Zod schemas; fixture + contract test; declared rate limits | Med | TODO |
| F6 | Additional ATS/career-site adapters | `packages/job-pipeline/src/adapters/{lever,smartrecruiters,workable,icims,successfactors}/` | One adapter each with fixture + contract test; registered; trust tiers correct | Med | TODO |
| F7 | Candidate-targeted search | `packages/job-pipeline/src/search/` + jobs service | Query builder from candidate skills/role/location/goals; results deduped into the one pipeline; relevance→match reused (A3) | Med | TODO |
| F8 | Scheduled crawl + budget/kill-switch | `apps/worker/src/*.worker.ts` | Scheduled Firecrawl search/crawl jobs; credit/cost accounting + cap; kill switch; idempotent job IDs | Med | TODO |
| F9 | Policy / legal / docs update | `AGENTS.md` §3.4/§15, `docs/` (new `docs/job-sources.md`), `plan/security.md` | Rule #4 amended per U6; robots/ToS + rate-limit policy documented; egress paths listed | High | DECISION |
| F10 | Verification scripts + CI | `scripts/verify-*`, `.github/workflows/` | Contract tests run in CI; allowlist includes Firecrawl; prompt/version + image-pin gates stay green | Low | TODO |

## Progress log

- **Wave 1 dispatched** (workers W1-A..E): T5 (GCM tag length), T1 (`packages/ui/src/motion.ts`), T10 (Slack OAuth `state`), T4 (web no-analytics direct-deps test), T7+T15 (sign-up advisory lock + trusted client IP). All reported complete → moved to REVIEW; central verification pending.
- **Baseline established:** APFS verify copy installed successfully with `--no-frozen-lockfile` (revealing T16); `turbo run typecheck` baseline reveals T17; install warning reveals T18.
- **Verification procedure corrected:** the first `turbo typecheck` baseline was misleading — Prisma Client was not generated, producing hundreds of phantom `Prisma.*` errors. Correct procedure: `pnpm install` → `pnpm --filter @careeros/api exec prisma generate` → build the library packages → `turbo run typecheck`.
- **Policy decision U6:** owner chose the recommended scope — permit Firecrawl + direct crawling of **public company career sites and ATS boards** (Workday, Lever, SmartRecruiters, Workable, iCIMS, SuccessFactors) with robots.txt/ToS respect and rate limits; **keep** the LinkedIn/Indeed/Naukri/Glassdoor server-side scraping ban. `AGENTS.md` rule #4 will be amended (F9) accordingly.
- **Wave 2 dispatched** (workers W2-A..D): T8 (container hardening), T9 (CI SHA pinning), T3 (missing scripts/compose), T12 (pnpm overrides contradiction). All reported complete → REVIEW; central verification pending. T12 outcome: the workspace comment was wrong; pnpm 9.12 reads root `pnpm.overrides`, so the comment was fixed, config kept.
- **Independent verifier (Wave 1+2):** PASS on T5, T1, T10, T4, T7, T15 (core), T8, T9, T3, T12. Micro-fixes raised: shared `clientIp()` in setup/security middleware, `dev-host.sh` path typo, T4 optional/peer deps coverage, trivy comment. No stubs/TODOs in changed security paths.
- **Wave 3 dispatched** (build blockers after `prisma generate`): W3-A T21/T14 (`deepseek.ts` subpath import + `ensureBaseUrlSafe` + `testStreaming` safeFetch) DONE; W3-B T22/T24 (api `email-parsers` dep + job-pipeline tsconfig paths) DONE; W3-D T17 (resume-render React type resolution) DONE; W3-C T23 interrupted by server restart → retried; W3-F T25 (test typing) in progress; W3-E verifier micro-fixes in progress.
- **Server restart** wiped the APFS verify copy's `node_modules`; rebuild scheduled before the next central verification.
- **Central verification (Wave 1-3):** all 13 packages build; `turbo run typecheck` 26/28 tasks pass. Remaining: `@careeros/worker` (T11 — v5 vs v6 Prisma client, ungenerated) and `@careeros/api` (3 leftover T23 test-typing errors). Wave 4 dispatched to close both.
- **U6 resolved** (owner): Tier 6 scope = public career sites/ATS + Firecrawl; LinkedIn/Indeed/Naukri/Glassdoor server-side scraping stays banned.
