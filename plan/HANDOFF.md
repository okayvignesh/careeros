# Career OS — Session Handoff (2026-09-28)

**Purpose.** Get a fresh Claude Code session productive in one read. This is the money file: everything a new session needs, cited to commit SHAs. Older detail lives in `plan/COMPLETION_PLAN.md`, per-phase files, and `plan/DEFERRED.md`.

**Baseline:** `b519769` (pre-Wave-A snapshot). **HEAD:** `c9218b6`. **Commits since baseline:** 213.

---

## 1. Where we are

- **Waves shipped:** A (all 20 findings), B (all 10 backfill streams + B-11 Next 16 bump), C alpha through eta (~70 streams across P0..P4), first cross-wave batch of D + E + F (agent platform, Slack + Gmail, approvals + audit-log).
- **Test suite:** Vitest across `apps/api`, `apps/web`, `packages/*`; suite runs green locally (specific counts drift as new tests land; use `pnpm test` to poll).
- **Full stack live-tested end-to-end:** Docker infra network up, API on `:3001`, Web on `:3000`, DeepSeek + local embedder wired, wizard walkable, browser hits confirmed.
- **Prisma:** upgraded 5.x → 6.19.x with `$extends` middleware replacing legacy `$use`.
- **Next.js + React:** apps/web on Next 16.3.6 + React 19.3.0 + Tailwind (Next 15 was a stepping stone in B-11, then bumped again in Cgamma-next16).

**Working-tree state at write-time:** 125 files modified (unrelated in-flight edits owned by the parallel web session). Only touch `plan/*.md` in this session.

---

## 2. What shipped by wave (with commit refs)

### Wave A — Immediate hardening (20 of 20)

| Stream | Ship | Commit(s) | Notes |
|---|---|---|---|
| A-C1 rate-limit + lockout | shipped | `85a3afb` | `@nestjs/throttler` + Redis storage + LoginAttempt lockout |
| A-C2 SSRF assertPublicUrl | shipped | `27e586f`, `1a86fbb`, `432b83c`, `fa5e10b` | DNS-resolved allowlist; browser-safe split shipped later |
| A-H1 CSRF double-submit + Sec-Fetch-Site | shipped | `df8d246`, `4f113d8` | `__Host-careeros_csrf` cookie; web fetch wrapper echoes on non-GET |
| A-H2 Helmet HSTS + nonce-CSP | shipped | `4926311` |  |
| A-H3 session revocation + sessionId | shipped | `fbc4596` | ActiveSession table + password-change invalidation |
| A-H4 strict MASTER_KEY | shipped | `189dbfc` | 64-hex or 44-base64 only |
| A-H5 max_tokens + Zod retry + injection scan | shipped | `b36b938`, `2252337`, `c75f195` | `wrapUntrusted` merged so injection ceiling ships live |
| A-H6 GH PAT scope gate | shipped | `78d761d` | x-oauth-scopes inspection before persist |
| A-H6b GL PAT scope (via C-P1.6) | shipped | `409d8d2`, `7c601fe` | mirror in gitlab.service |
| A-H7 multer v2 + unpdf + pnpm audit CI | shipped | `9d926a7` |  |
| A-H8 docker egress split + Squid | shipped | `ab9d05b` | internal/egress networks + allowlist |
| A-H9 remove docker default passwords | shipped | `9c5dff9` | startup-check refuses weak creds at both layers |
| A-L1 hide LLM error string | shipped | `b38c5c0` |  |
| A-M1 `__Host-careeros_session` cookie forced | shipped | `c82479b`, `de005ec` | env override dropped |
| A-M2 pg_advisory_xact_lock + generic 409 | shipped | `8a9686b` | setup-account race + P2002 |
| A-M4 encrypt hallucination log snippet + 30d retention | shipped | `c6c82bf` |  |
| A-M5 magic-byte MIME + per-user signed URLs | shipped | `e2417e0` | MinIO fallback keys removed |
| A-M6 single-user guard on /me/* config | shipped | `c317d17` |  |
| A-M7 image pinning by sha256 | shipped | `96d366a` | image-pins CI job |
| A-M8 middleware fail-closed to /service-unavailable | shipped | `b670dd9` |  |
| A-M9 per-user p-limit(2) on LLM calls | shipped | `841861a` | UsageService.runWithUserLimit wraps every call site |

Wave A remediation (Batch1 + Batch2): `Batch1-fix-{1..5}`, `Batch2-fix-{1..7}` — assorted honesty fixes (rewrite tests as real vitest, extract security middleware for prod-code assertion, drop dead env, `Retry-After` header via `LockoutExceptionFilter`, echo `__Host-careeros_csrf`, etc.).

### Wave B — Test backfill (11 of 11)

| Stream | Ship | Commit(s) |
|---|---|---|
| B-1 assessments split (grading + boss-battle + next-task) | shipped | `b1c6628`, `dd3e5a9`, `310718c` |
| B-2 boss-battle server-authoritative timer | shipped | `dd3e5a9` (included in B-1b) |
| B-3 resume-variants fact-check gate + hallucination-guard | shipped | `65a582d` |
| B-4 cover-letters grounded-generation + factRef contract | shipped | `7b187c5` |
| B-5 market-brief stats + LLM synthesis + URL post-filter | shipped | `cbacad2` |
| B-6 GitHub service happy path + rate-limit backoff | shipped | `932c8a5` |
| B-7 skills aggregation math + state-transition | shipped | `cabe290` |
| B-8 embeddings encode → upsert → search round-trip | shipped | `395a3fe` |
| B-9 renderResumePdf byte + unpdf round-trip | shipped | `09a0a67` |
| B-10 job-pipeline stages extracted + tests | shipped | `b4fd58c`, `a5ec56f` |
| B-11 Next 14 → 15 bump + async params migration | shipped | `0ee6f25`, `10dac8f`, `345d80a`, `88c7b97` |

Wave B remediation: `WaveB-fix-1` (grading test type errors: duplicate id + exactOptionalPropertyTypes) `fc415cd`; `WaveB-fix-2` (move resume-render fixture under `src/`) `55fbe48`.

### Wave C — Finish P0..P4 unchecked

**C-P0 (7 of 8 shipped):**

| Stream | Ship | Commit(s) |
|---|---|---|
| C-P0.1 AIProvider registry | shipped | `d5dcd0b` (P0.1b only; P0.1a interface exists prior) |
| C-P0.2 Prompt registry + hashOf + CI gate | shipped | `8a18278`, `4ac3959`, `cdd0d37` |
| C-P0.3 sensitivity gate + wrapUntrusted wire + re-auth window | shipped | `f51f646`, `aac56b0` |
| C-P0.4 packages/testing skeleton + msw + fast-check + storage-state + example integration + README | shipped | `5127ebb`, `c8b978f`, `f65c779`, `860247d`, `d8a692d` |
| C-P0.5 CI workflows (pr / restore-test / nightly-evals / tag-release + cosign + syft) | shipped | `6ed45a9`, `0e5b47b`, `1cbd42e`, `66a2d32` |
| C-P0.6 first-run failure recovery + Playwright golden flow | **deferred** | — |
| C-P0.7 passkey + recovery codes | shipped | `34f2b9b`, `8daf48d`, `14ff0bd`, `d44a60b` |
| C-P0.8 backup + restore + retention + docs | shipped | `d57b44b`, `4197789`, `f89d134` |

**C-P1 (6 of 6 shipped):**

| Stream | Ship | Commit(s) |
|---|---|---|
| C-P1.1 commit-analysis (language-detect + framework-hints + orchestrator + wire) | shipped | `1b08cda`, `e2621fe`, `c8b978f`, `c83b55f` |
| C-P1.2 learning_priority formula + service + wire | shipped | `635e8ab`, `1cf6b4b`, `ef9ae94` |
| C-P1.3 ESCO seed (188 skills) + skill_fact + fact_base | shipped | `a1bce36`, `3ba64f4`, `f4396ca` |
| C-P1.4 skill-extract evals (20+ fixtures + runner + judge + eval script) | shipped | `e71f53f`, `75747af`, `848e027` |
| C-P1.5 Prisma 6 + $extends migration + pg_dump opacity test | shipped | `653c46c`, `e099c0c`, `39cf678`, `fcf76b4`, `7e15bf7` |
| C-P1.6 GitLab integration (public + self-hosted, PAT + safeFetch + tests) | shipped | `253f667`, `409d8d2`, `c63e29d`, `7c601fe` (P1.6d absent = tests folded into P1.6e) |

**C-P2 (8 of 8 shipped, partial for consumer wire):**

| Stream | Ship | Commit(s) |
|---|---|---|
| C-P2.1 packages/sandbox (skeleton + docker wrapper + pool + kill-switch + tests) | shipped | `2b3c2bf`, `78ae69a`, `a460f95` |
| C-P2.2 sandbox security suite + operator smoke | shipped | `12cf32f`, `7412833` |
| C-P2.3 Monaco CodeEditor + drafts hook | shipped | `c727a1e`, `d7ecd14`, `898f283` |
| C-P2.4 build-code assessment consumer wire | **deferred (marked in-code TODO)** | `751307e` (WaveC-alpha-fix-2 leaves the TODO) |
| C-P2.5 verbal + mock-interview multi-turn | **deferred** | — |
| C-P2.6 quest generator + prereq graph + hours + controller | shipped | `f500d3f`, `39e0bf4`, `b18e90d` |
| C-P2.7 corpus adapters (tih + programmer-should-know) + cosine dedupe + refresh worker + embeddingId | shipped | `7b830f6`, `e02dcac`, `7971f78`, `3817aa7`, `c3e160a` |
| C-P2.8 agent registry + orchestrator + eval-set helper + boot wiring | shipped | `efb6901`, `9b0ecb4` |

**C-P3 (8 of 8 shipped):**

| Stream | Ship | Commit(s) |
|---|---|---|
| C-P3.1 ATS + aggregator adapters + registry + wire | shipped | `71add8f`, `6a527e0`, `a652a89` |
| C-P3.2 verify stage + trust-order + cross-source dedupe + job_reject_log + controller | shipped | `78c0c9d`, `eed62d9`, `d3ac77b`, `2d75721`, `9fab7e3` |
| C-P3.3 seniority + role classifier + comp-band + FX | shipped | `ef2dc5c`, `523b922`, `fea8848` |
| C-P3.4 market_snapshot table + service + controller + weekly cron | shipped | `feb251a`, `4aa8357`, `162be21`, `3c5fcdf` |
| C-P3.5 screens 33/56 | shipped | `49e8393`, `1ddd705` |
| C-P3.6 adapter contract tests + weekly cron + shape-diff | shipped | `5d19b79`, `03a5ebb`, `ec4af44` |
| C-P3.7 wrapUntrusted on jobs + market-brief + resume + dossier | shipped | `1a2551e`, `8d7192a`, `8e9b15e`, `55657ed` |
| C-P3.8 requireAdmin guard + decorator + tests | shipped | `24f436b` |

**C-P4 (8 of 8 shipped):**

| Stream | Ship | Commit(s) |
|---|---|---|
| C-P4.1 matcher service + controller | shipped | `809b9a4`, `61dc045` |
| C-P4.2 unified ResumeDoc + DOCX renderer + templates + tests | shipped | `519ef56`, `8ae9d20`, `35c8079` |
| C-P4.3 resume + cover-letter version diff | **deferred** | — |
| C-P4.4 company dossier pipeline + controller + tests | shipped | `8ca18ef`, `d7ed1e5` |
| C-P4.5 application detail + timeline | **deferred (Kanban parked)** | — |
| C-P4.6 screens 36–44 | **deferred** | — |
| C-P4.7 fact-check gate extract + wire (market-brief + resume + cover-letter + dossier + evals) | shipped | `70df867`, `619ed3a`, `d24f62e`, `e482d1b`, `db913d5` |
| C-P4.8 metrics service + prom-client + /metrics + pino + LLM + Prisma hooks | shipped | `c3e160a`... `c3e160a`? — actually `c3ee476` is P2.7e; C-P4.8 = `c3e160a`, `86fa931`, `14b1d9b`, `16bac7d` |

Wave-C remediation: `Cgamma-next16-{a,b}` `68bc18e`, `68b77c3` (Next 16 async-API + React 19 rename); `WaveC-alpha-fix-{1,2}` `ff5af1f`, `751307e` (SectionHeader + Stat primitives; sandbox consumer wire TODO); `WaveC-beta-fix` `38be28c` (jobs.service.test mock.calls type).

### Wave D — Desktop companion agent (partial: 3 of 8 shipped)

| Stream | Ship | Commit(s) |
|---|---|---|
| D.1 packages/browser-agent skeleton + pacing + allowlist + kill-switch + selector-health + tests | shipped | `4212b78`, `85d9ebd`, `074c57b`, `58191c6`, `9537bbb` |
| D.2 migrations + pair endpoints + WSS gateway + rate limits + audit_log + tests | shipped | `7e4957e`, `7f2a3b4`, `64dc1e0`, `4563b4b` |
| D.3 web downloads page + Settings→Devices panel | **not started** | — |
| D.4 Electron scaffold + tray + pairing window + keytar + wss-client + task-runner | **not started** | — |
| D.5 linkedin-selectors + linkedin-parse + linkedin-discover Playwright script + probe + README | shipped | `7537f04`, `09726fa`, `b964eee`, `13ab751` |
| D.6 packaging (electron-builder + electron-updater) | **not started** | — |
| D.7 auth JWT scope + refresh rotation + pairing rate limit + version reporting | shipped via D.2 (verified 2026-09-28) | agent.controller.ts + agent.service.ts + agent.gateway.ts + tests |
| D.8 ops (proxy config, screenshot cleanup, log rotation) | **not started** | — |

### Wave E — Daily assistant (partial: 3 of 9 shipped)

| Stream | Ship | Commit(s) |
|---|---|---|
| E.1 Slack app manifest + install docs | **not started** (E.2d ships docs partial) | — |
| E.2 Slack Events + signing + dedupe + slash commands + Block Kit + OAuth + controller + manifest + docs | shipped | `8ac1e41`, `74713a4`, `ec15f9c`, `bd2c82b` |
| E.3 daily-brief composer + tz-aware scheduler | **not started** | — |
| E.4 Gmail Pub/Sub + history diff + watch renewal cron | shipped | `9b69468`, `a180dee`, `8066c9b`, `f45a39b` |
| E.5 email classifier (heuristic + LLM prompt + orchestrator + 27 fixtures) | shipped (wire into email-ingest deferred to E.7) | `299fabd` |
| E.6 email-parsers package (linkedin/indeed/naukri) + fixtures + evals + ingest service + wrapUntrusted + consumer | shipped | `e59ef71`, `7f23899`, `687c73e`, `c9218b6` |
| E.7 email→application fuzzy match + inbox triage | **not started** | — |
| E.8 injection defense on emails | **partially, via E.6e wrapUntrusted wire** | `c9218b6` |
| E.9 packages/messaging Channel interface + Slack impl (injected) + Web + stubs + registry + prefs | shipped | `cbd6dcd` |

### Wave F — Controlled execution (partial: 2 of 11 shipped)

| Stream | Ship | Commit(s) |
|---|---|---|
| F.1 approval queue + state machine + controller + bulk-threshold + re-auth + tests | shipped | `74e3a4c`, `631a997`, `c7e2c25`, `4326e3d` |
| F.2 ATS submit adapters (Ashby, Greenhouse, idempotency, backoff) | **not started** | — |
| F.3 agent form-fill (allowlist YAML + scripts + probe) | **not started** | — |
| F.4 interview prep + talk-track + fact-check | **not started** | — |
| F.5 outreach composer + templates + timing + Gmail drafts | **not started** | — |
| F.6 audit_log append-only DDL + retention worker + test + docs | shipped | `411556e`, `d99d0a4`, `b319dee`, `eb50acd` |
| F.7 backup + restore CI + off-site + RPO/RTO | **partially via C-P0.5b + C-P0.8** | — |
| F.8 data portability (export + delete + parity + USER_TABLES SoT) | shipped (unit tests; MinIO + age + integration deferred) | `5a800b0` |
| F.9 Advanced Usage & Costs dashboard | **not started** | — |
| F.10 screens 45/46/47/48/57/59/60/63/64 | **not started** | — |
| F.11 requireAdmin guard + webhook rate limits + scope drop-unused | **partial: C-P3.8 admin guard + F.11a Gmail push 300/min + F.11c OAuth scope audit** | `24f436b`, `bfb8271`, `a4d6877` |

### Setup flow audit remediation

`flow-fix-{1,2,3}` `5ba95c6`, `ca08866`, `1e779b8`: expose setup step slugs from `/setup/state`; gate `/setup/*` by allowedSlugs and redirect `/sign-in` when done; not_started points at `02-account` not `01-preflight`.

### Infra + host fixes

- `cf292da` minio user:0:0 + squid tmpfs `/var/log/squid`
- `bd0588d` minio healthcheck curl instead of missing wget
- `170b9ae` perf: remove CodeEditor value export from `@careeros/ui` barrel
- `1a86fbb` shared: split net/shape (browser-safe) from net/assert-public-url (node:dns)
- `44716a0` host-dev: react-pdf 4.9 for React 19; api tsconfig paths alias for `@careeros/shared/net`
- `3ec0c55` web: fix Tailwind not loading under Next 16 (subpath net export, drop --webpack)
- `d62b6d0` + `974af42` web: restore webpack node: shim (barrel re-exports `./net` again)
- `6fecd44` auth: accept cross-origin non-GET when Origin is in TRUSTED_ORIGINS
- `dc9059f` backlog #70: test TRUSTED_ORIGINS carve-out (positive + negative)

### Backlog burn-down (documentation + minor code)

`backlog:#14`, `backlog:#19`, `backlog:#27`, `backlog:#39`, `backlog:#52`, `backlog:#61`, `backlog:#70`, `backlog:#74`, `backlog:#80`, plus generic `backlog:` refreshes. See git log for one-line notes. Full deferred list in `plan/DEFERRED.md`.

---

## 3. What's still open

### 3a. Non-web streams ready to dispatch

Each of these can spawn a fresh implementer immediately. No apps/web collision.

| Stream | Scope | Depends on |
|---|---|---|
| C-P0.6 first-run failure recovery + Playwright golden flow | plan/phase-0-install.md:150 + G-UX-1 | wizard is already green — this adds the recovery UX + storage-state fixture |
| C-P2.4 build-code sandbox consumer wire | see TODO in packages/sandbox from `751307e` | C-P2.1 pool (shipped) |
| C-P2.5 verbal + mock-interview multi-turn | plan/phase-2:94-105 | whisper.cpp service in compose |
| D.6 packaging (electron-builder + updater) | plan/phase-3.5:65-68 | D.4 Electron scaffold |
| D.8 ops (proxy + screenshot cleanup + log rotation) | plan/phase-3.5:116-118 | D.4 Electron scaffold |
| E.3 daily-brief composer + tz-aware scheduler | plan/phase-5:41-43,91-95 | E.2 Slack + P1 dashboard data (both shipped) |
| E.7 email→application fuzzy match + inbox triage | plan/phase-5:83-87,108-115 | E.5 classifier |
| F.2 ATS submit adapters | plan/phase-6:26-32 | C-P3.1 adapters (shipped) |
| F.3 agent form-fill | plan/phase-6:35-43 | D.4 Electron |
| F.4 interview prep + talk-track | plan/phase-6:47-52 | C-P4.4 dossier (shipped) |
| F.5 outreach composer | plan/phase-6:55-61 | C-P4.7 fact-check gate (shipped) |
| F.9 Advanced Usage & Costs dashboard | plan/phase-6:107-118 | C-P4.8 metrics (shipped) |
| F.11b rate-limit remaining Slack webhooks (events/interactive/commands/oauth) | plan/phase-6:64-67 | dirty slack module in parallel session |

### 3b. Web-blocked streams (waiting on parallel session)

The parallel Claude session owns `apps/web/**`. Do not dispatch these until they release the surface:

| Stream | Web surface it touches |
|---|---|
| D.3 downloads page + Settings→Devices panel | apps/web/src/app/(app)/settings/devices, /downloads |
| C-P4.5 application detail + timeline UI | apps/web/src/app/(app)/applications/[id] |
| C-P4.6 screens 36–44 UI | many pages under apps/web/src/app/(app) |
| F.10 screens 45/46/47/48/57/59/60/63/64 | ditto |
| G-UX-1 / G-UX-2 / G-A11y / G-Notif | frontend-design + apps/web |

### 3c. External blockers (user must resolve)

- **MinIO deprecation.** `bitnamilegacy/minio:2024.10.29-debian-12-r1` is pinned in `infra/docker/docker-compose.yml:69` (see the `ponytail:` note there). Bitnami legacy is EOL; the official `quay.io/minio/minio` now requires auth for anonymous pulls. Blocking a real replacement is on the user (Ceph? SeaweedFS? MinIO with a docker-hub read token?). Tracked as task #22 in the transient tracker.
- **Slack marketplace review.** E.1 install docs stayed personal-workspace only; if the user wants public distribution they need to submit + wait weeks.
- **Gmail app verification.** E.4 shipped assuming self-hosted (up-to-100-user cap of developer's own account); public release needs Google verification for `gmail.readonly`.
- **Electron notarization + Windows EV cert.** D.6 packaging can ship unsigned MVP; signed releases need user's Mac Developer + Windows EV cert.
- **Weekly restore-test CI.** `.github/workflows/restore-test.yml` (C-P0.5b) needs at least one real week of runs before H can flip. Nothing to do — just wait and check.
- **9 §6 open decisions** from `plan/COMPLETION_PLAN.md#6`. Still awaiting formal answer:
  1. Product final name
  2. OSS-public vs personal-only
  3. VPS backup destination (S3 / B2 / rsync)
  4. Domain + TLS provider (nginx+certbot / Caddy)
  5. Mobile companion — parked
  6. UX trade-off checks for Wave A fixes (CSRF SameSite, SSRF allowlist, `__Host-` cookie, egress isolation)
  7. GitLab self-hosted FQDN(s)
  8. GitLab auth mode (PAT-only / PAT+OAuth2)
  9. GitLab issues ingest (yes / repos+MRs+pipelines only)

Say "approve defaults" to lock all nine; else answer per-item.

---

## 4. Known bugs + follow-ups

The transient task tracker resets between sessions. `plan/DEFERRED.md` (new, this batch) captures the ~30 items that were live in the session tracker at write-time. Highlights:

- MinIO deprecation replacement (external blocker; task #22).
- Sandbox consumer wire TODO (C-P2.4).
- Playwright storage-state fixture from a completed wizard (P1 golden flow).
- `pnpm fixtures:record` script (contract tests currently one-off).
- Dedicated `pnpm test:contract` script (currently folded into root `pnpm test`).
- `llm_injection_log` table + snippet + score columns (audit UI blocked).
- Sensitivity settings UI to review + change labels per repo.
- Wire `AppConfig` scoped by userId to close the A-M6 multitenant TODO.
- Circuit breaker on LLM provider (ai-safety Item 9, deferred).
- Per-call token cap enforcement pre-flight (needs js-tiktoken; deferred until first `llm_calls` middleware bites).
- Per-user daily/monthly cost budget UI + 429 (P1 dashboard shipped budget bar; enforcement path across all callers needs an audit).

Full list: `plan/DEFERRED.md`.

---

## 5. Recommended next dispatch template

Copy-paste this preamble into every implementer prompt. It carries the coordination rules that memory can't enforce automatically.

```
CRITICAL git discipline:
- Use `git commit --only <path>` per commit. Never `git add .`, never `git add -A`.
- Never touch apps/web/** — that surface is owned by the parallel Claude session.
- Never touch plan/_audit_*.md — historical audit records.
- Never touch CLAUDE.md, AGENTS.md.

Coordination:
- No em dashes in any user-facing string (memory rule).
- After every iteration ships, spawn a verifier agent before dispatching the next (memory rule).
- After adding a dep to apps/api, rebuild the service with `docker compose up -d --build --renew-anon-volumes api`.

Prisma migration timestamps used so far (do not collide):
  20260923060000 skill_graph_core
  20260924010000 assessment_arena_slice1
  20260924000000 llm_calls_composite_indexes
  20260925000000 remediation_tasks
  20260926000000 boss_battles
  20260927000000 question_source_columns
  20260928000000 jobs_walking_skeleton
  20260930000000 user_job_preferences
  20261001000000..20261012000005 (Wave A + C + D + E + F migrations — see prisma/migrations dir)
Next free slot: 20261012000006 or later.

File scope for this task:
- <list of files/directories the implementer may touch>
- Nothing else.
```

Common non-collision file scopes for parallel dispatch:

| Concern | Non-web files |
|---|---|
| Backend module | `apps/api/src/modules/<name>/**` + `prisma/schema.prisma` + `prisma/migrations/<ts>_<name>/**` |
| Worker | `apps/worker/src/<name>*.ts` |
| Shared package | `packages/<pkg>/src/**` + `packages/<pkg>/package.json` |
| CI workflow | `.github/workflows/<name>.yml` |
| Ops script | `scripts/<name>.sh` |
| Docs (non-plan) | `docs/<name>.md` |

---

## 6. Live state

**Datastores healthy on the Docker `internal` network:**
- Postgres 16 (pinned by sha256)
- Redis 7 (pinned)
- Qdrant v1.12.4 (pinned)
- MinIO bitnami-legacy 2024.10.29 (pinned; see external blocker in §3c)
- Squid 6.10 egress proxy (pinned)

**API + Web:**
- API on `:3001` (NestJS + Prisma 6.19.x + pino + prom-client)
- Web on `:3000` (Next 16.3.6 + React 19.3.0 + Tailwind)
- Both routed through the `egress` docker network via Squid for outbound HTTP(S)

**Env state:**
- `.env` + `.env.local` set with strong secrets (64-hex ENCRYPTION_KEY + SESSION_SECRET enforced by startup-check)
- DeepSeek API key wired for LLM
- Local embedder (bge-small-en) selected

**Infra bugs fixed this run:**
1. `cf292da` minio user 0:0 for volume chown, squid tmpfs `/var/log/squid`
2. `bd0588d` minio healthcheck curl instead of missing wget
3. `06b8056` market_snapshot unique index IMMUTABLE constraint

**Prisma:**
- 6.19.x with `$extends` middleware (migrated from `$use` in C-P1.5c)
- ENCRYPTED_FIELDS map + LLM audit hook preserved through the migration

---

## 7. Coordination rules (memory-enforced)

Recorded in `/Users/vignesh.v/.claude/projects/-Users-vignesh-v-Desktop-personal-career-os/memory/MEMORY.md`:

- `apps/web/**` is owned by parallel Claude session — do not touch.
- `git commit --only <path>` per commit — never `git add .`.
- Never emit em dashes in any Career OS user-facing string.
- After every iteration ships, spawn a verifier agent before moving to the next; never skip.
- After adding a dep to `apps/api` or `apps/web`, rebuild the service with `--renew-anon-volumes` or the container keeps serving the old build.
- Treat shipped screens as wireframes only; use `frontend-design` skill for the real visual layer.
- Docker deps workflow: rebuild the service after adding a dep.

---

## 8. Fastest way to catch up (for a fresh session)

1. Read `plan/HANDOFF.md` (this file). Skim §2 for what shipped, §3 for what's open.
2. `git log --oneline | head -50` to see the most recent tip and pick up any commits made after this handoff.
3. Read `plan/COMPLETION_PLAN.md` for the wave structure — every shipped stream has a `SHIPPED (<sha>)` marker inline.
4. Read `plan/PLAN.md#Phase status board` for the per-phase state column.
5. Read the phase file for the phase you're touching (`plan/phase-N-*.md`) — ticked boxes carry `Shipped: <sha>` annotations; `[~]` markers flag partials with what's left.
6. Read `plan/DEFERRED.md` for the follow-up burn-down list.
7. Only after §1–6, start dispatch. Use §5 template preamble.

---

## 9. What NOT to do

- Do NOT commit changes across the 125 files currently modified in the working tree. Those are owned by the parallel web session.
- Do NOT flip any phase to `Done` in `plan/PLAN.md`. Phase gating rule (`plan/PLAN.md#Phase gating`): every phase file's boxes ticked + Playwright golden flow green in CI + `frontend-design` review + blueprint DoD met + date noted. None of the phases meet all four yet.
- Do NOT rewrite `plan/_audit_*.md` files. They are historical records — treat as append-only if at all.
- Do NOT dispatch to a new phase before verifying the previous batch. Verifier-per-iteration rule (`feedback_iteration_verification.md`).
- Do NOT introduce a new dependency for what a few lines can do (`AGENTS.md` ponytail rule).
