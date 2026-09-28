# Career OS — Deferred Follow-ups

Compact ledger of follow-ups the harness task tracker was carrying at write-time. The tracker resets between sessions, this file does not. Grouped by phase / cross-cutting area for pickup planning.

Last refreshed: 2026-09-28. Baseline commit for the wave: `b519769`. HEAD: `c9218b6`.

---

## External blockers (user action required)

| # | Item | Blocks | Notes |
|---|---|---|---|
| 22 | MinIO deprecation replacement | infra hygiene, H release chain | `bitnamilegacy/minio:2024.10.29-debian-12-r1` pinned (`infra/docker/docker-compose.yml:69` + `ponytail:` note). Bitnami legacy EOL, `quay.io/minio/minio` needs auth for anonymous pulls. Options: Ceph, SeaweedFS, MinIO with a docker-hub read token, or bake MinIO ourselves. |
| 23 | 9 §6 open decisions | H release + C-P1.6 self-hosted path | See COMPLETION_PLAN.md §6. "approve defaults" locks all. |
| 24 | Slack marketplace review | E.1 public distribution | Personal-workspace works today. |
| 25 | Gmail app verification | E.4 public distribution | Self-hosted (up to 100 users of dev's own account) works today. |
| 26 | Electron notarization + Windows EV cert | D.6 signed release | Unsigned MVP OK per phase-3.5 non-goals. |
| 27 | Weekly restore-test CI real week | H flip | `.github/workflows/restore-test.yml` cron runs Mondays 03:00 UTC. Wait, don't poke. |

---

## Cross-cutting: security.md unticked, not yet blocked

- HTTPS reachable in prod (item 1) — cannot enforce until VPS + domain + TLS choice landed.
- Postgres `sslmode=require` in prod (item 1) — same gate.
- `startup-check.ts` negative-case tests (item 1) — most exist but full grid deferred.
- Passkey wizard prompt at recovery-key step (item 3) — needs UI wire (web-owned).
- Multi-tenant `AppConfig` scope by userId (A-M6 TODO) — single-user works today, tracked at every `/me/*` mutating handler.
- Session-list + revoke UI (item 3 + G-Auth) — web-owned; ActiveSession model + endpoints shipped in A-H3.
- Passkey recovery + rotation UX (screen 59) — web-owned.
- Playwright header-presence test on `/`, `/setup`, `/api/health` (item 2) — deferred with P0 golden flow.
- `securityheaders.com` grade A verification (item 2) — needs live host.
- Pairing endpoint 5/hour (item 4) — D.2 shipped device pairing; explicit 5/hr limit needs one more line + test.
- Full grid of tables in ENCRYPTED_FIELDS (item 5) — `career_goals`, `evidence`, `applications`, `outreach_messages` still to add.
- Backup `pg_dump` opacity byte-inspection test (item 5) — round-trip lives in C-P1.5e; backup path test deferred.
- RPO24 / RTO2 documentation (item 8) — one paragraph in `docs/backup.md`.
- `ENCRYPTION_KEY` explicit exclusion from backup verify test (item 8) — one negative test.
- `no analytics SDK in web` guard test (item 6).
- `NEXT_TELEMETRY_DISABLED=1` in web Dockerfile.
- `USAGE_STATS=on` opt-in env stub.
- `docs/security.md` outbound-path listing.
- ~~Renovate config + weekly PR cadence (item 10).~~ SHIPPED 2026-09-28: `.github/renovate.json` with Monday-6am schedule, grouped by nestjs/prisma/next+react/simplewebauthn/type-defs/docker, monthly lock-file maintenance, vulnerability alerts always-on.
- CodeQL + Trivy CI gates (item 10).
- Distroless base images + non-root UID + read-only rootfs + cap-drop + seccomp (item 10).
- `gitleaks` pre-commit hook + CI job (item 10).

## Cross-cutting: ai-safety.md unticked

- Grounded generation contract on every claim (item 1) — resume + cover-letter ship it; market-brief + dossier partial via post-filter; per-domain schemas need `evidence_refs` typing.
- ESLint rule blocking `chat()` in non-UI modules (item 2).
- `JSON mode / function calling` capability probe branch (item 2).
- Prompt file schema-in-same-module enforcement (item 3).
- Injection scan on LLM-classifier borderline (item 5).
- `llm_injection_log` table (item 5) — today the flag lives on `audit_log`; dedicated table + snippet + score column deferred to when the audit UI ships.
- User-facing audit-log view of flagged items (item 5).
- Public injection corpus regression eval (item 5) — a ≥90% detection target on a chosen threshold.
- `packages/ai/fact-check.ts` shared extract (item 6) — B-3 + B-4 use per-domain form; extract when a 3rd consumer needs it. C-P4.7 partially done.
- Fact-check unit test with 3 backed + 1 fabricated (item 6) — needs stub LLM provider in test infra.
- Agent boundaries: `packages/ai/agents/` per-role files (item 7) — 2 shipped in C-P2.8; grader/prep/talk-track/outreach TBD.
- Sensitivity gate: settings UI to review + change labels per repo (item 8).
- `llm_calls` retention 90d configurable (item 9).
- Circuit breaker on provider error > 20% in 5 min (item 9).
- Per-user daily/monthly cost budget UI + 429 on breach (item 9) — budget bar shipped in P1 dashboard; enforcement `assertCallAllowed` shipped; UI 429 UX + reset time deferred.
- Per-call pre-flight token cap (item 9) — needs `js-tiktoken`.
- Full evals suite for skill-extract at 20+ (item 10) — 20+ shipped in C-P1.4b; other prompts (fact-check, injection-scan, resume-tailor, question-generator, assessment-grader) still to fill.
- Nightly eval drift alert wiring (item 10) — `.github/workflows/nightly-evals.yml` shipped in C-P0.5c; drift-vs-baseline compare + Slack/email alert deferred.

## Cross-cutting: testing.md unticked

- ESLint rule for auto-generated `data-testid` (item 3 rule 3).
- Per-worker Postgres schema isolation for Playwright (item 3 rule 6).
- Migration forward-safety per-migration test scaffold (item 6).
- Recorded `pnpm fixtures:record` script for adapter contract fixtures (item 5).
- Dedicated `pnpm test:contract` script (currently folded into root `pnpm test`).
- Backup byte-inspection assertion (item 7).
- `age` wrong-key negative test (item 7).
- Test failure GitHub-issue autofile (item 7).
- Visual regression baseline set + `toHaveScreenshot()` (item 9).
- Fuzz for email parsers (P5) beyond golden fixtures (item side-car).
- Pre-commit hook via lefthook or husky (item 11).

## Cross-cutting: observability.md unticked

- `console.log` ESLint rule (rule set, no console.log in prod today but not enforced).
- Docker `json-file` log driver `max-size=10m`, `max-file=5`.
- GlitchTip compose service + Sentry SDK integration with `beforeSend` PII scrub.
- MinIO check in `/health`.
- OpenTelemetry adapter shim in `packages/shared/trace.ts` (deferred by spec; item stays open).
- `docs/observability.md` operator setup.
- Grafana dashboards + example `alertmanager.yml` in `docs/observability/`.
- Metrics endpoint scrape-behind-nginx-auth stance (item metrics).

---

## Phase-level open follow-ups (not yet scheduled)

### P0 (install)
- C-P0.6 first-run failure recovery + Playwright golden flow end-to-end.
- Screens 66 (service unavailable) + 67 (not found).
- `docs/dev-setup.md`, `docs/architecture.md`, Contributing guide, `.vscode/launch.json`.
- Swagger + `/api/openapi.json` + prisma-erd-generator.
- nginx config + certbot + `scripts/deploy.sh`.
- `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md` at repo root.

### P1 (personal intelligence)
- `learning_priority` end-to-end (formula shipped in C-P1.2; wire into dashboard).
- ESCO seed script full run (188 skills seeded via C-P1.3b; verify against candidate use case).
- Prompt-per-usage schemas that make `evidence_refs` a hard schema constraint.
- Playwright golden flow with real storage-state from a completed wizard.

### P2 (assessment arena)
- C-P2.4 build-code sandbox consumer wire (TODO annotated in `751307e`).
- C-P2.5 verbal + mock-interview multi-turn.
- Streaming grader UI (`chatStructured` streaming variant on provider).
- Boss-battle 3+ related-skills threshold + multi-skill combo requirement.

### P3 (market engine)
- Weekly cron schedule for market brief (walking-skeleton runs on-demand).
- "What changed vs last week" diff.
- Reject-audit UI (`job_reject_log` shipped in C-P3.2d).
- N+1 fix in `JobsService.sync` (parked debt in phase-3-market-engine.md:200).
- Match-score pagination pool ceiling → `user_job_match` precompute (parked debt).

### P3.5 (desktop agent)
- D.3 downloads page + Settings→Devices (web-blocked).
- D.4 Electron scaffold + tray + pairing window + keytar + wss-client + task-runner.
- D.6 packaging (electron-builder + updater).
- D.7 JWT scope refinement + rotation tests.
- D.8 proxy config + screenshot cleanup + log rotation.

### P4 (the hunt)
- C-P4.3 resume + cover-letter version diff UI (`diff-match-patch`).
- C-P4.5 application detail + timeline UI (web-blocked).
- C-P4.6 screens 36-44 (web-blocked).
- ATS-lint per-rule tests (linter `packages/resume-render/lint.ts`).
- Fact-check unit test with 3 backed + 1 fabricated (needs stub LLM).

### P5 (daily assistant)
- E.1 Slack app manifest + install docs (E.2d shipped partial docs).
- E.3 daily-brief composer + tz-aware scheduler.
- E.5 email classifier + eval sets per class.
- E.7 email→application fuzzy match + inbox triage screen 50.
- E.9 packages/messaging Channel interface + Web channel + stubs for WhatsApp/Discord.

### P6 (controlled execution)
- F.2 ATS submit adapters (Ashby, Greenhouse).
- F.3 agent form-fill (allowlist YAML + scripts + probe).
- F.4 interview prep + talk-track + fact-check.
- F.5 outreach composer + templates + timing + Gmail drafts.
- F.7 backup + restore CI + off-site + RPO/RTO (partial via C-P0.5b + C-P0.8).
- F.8 data portability (`/me/export` + `/me/delete` + parity).
- F.9 Advanced Usage & Costs dashboard.
- F.10 screens 45/46/47/48/57/59/60/63/64 (web-blocked).
- F.11 rate-limit every public webhook + scope drop-unused.

---

## Backlog issues by number (from historical audits)

Not exhaustive; these are the ones the harness tracker referenced with `backlog:#N` at commit time.

| # | Status | Ship | Notes |
|---|---|---|---|
| #14 | shipped | `314fec7` | pnpm-workspace.yaml overrides comment |
| #19 | shipped | `2b852ca` | field.test.ts as real vitest cases |
| #27 | shipped | `386a0f0` | security.md line 86 CSRF cite drift |
| #39 | shipped | `aee17fb` | wrap github-sync octokit calls in shared retry |
| #52 | shipped | `74cafa2`, `386a0f0` | testing.md item 5 + 7 + 8 boxes |
| #61 | shipped | `583af2d` | docs for company dossier endpoints |
| #70 | shipped | `dc9059f` | test TRUSTED_ORIGINS carve-out |
| #74 | shipped | `c63a615` | move GitlabSyncPayload to packages/shared/queues.ts |
| #80 | shipped | `06b8056` | market_snapshot unique index IMMUTABLE |
| others | pending | — | If a `backlog:#N` reappears in future commits, mark here. |

---

## Live in-flight (in the working tree at write-time)

125 modified files across `apps/api/**`, `apps/web/**`, `packages/**`, `Makefile`, and Prisma schema live in the working tree owned by the parallel session. Not to be committed from this plan-sync session. When the parallel session lands them, cross-check this ledger for any newly-satisfied items.
