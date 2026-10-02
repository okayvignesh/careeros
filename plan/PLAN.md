# Career OS — Implementation Plan

Living document. Update as decisions change or phases move.

## Locked decisions

| Area | Choice | Note |
|---|---|---|
| Design direction | Linear / Vercel — minimal, dense, dark-first, mono accents | Every screen passes through `frontend-design` skill before merge |
| Primary LLM | DeepSeek API (owned key) | Provider-agnostic abstraction still built |
| Embeddings | Local `bge-small-en` (default) | External embeddings pluggable |
| Deployment | VPS from day 1 — nginx + TLS + backups | Compose stays laptop-runnable too |
| Frontend | Next.js 15 (App Router) + TS + Tailwind + shadcn/ui | |
| Backend | NestJS + TS | |
| Workers | Node + BullMQ | |
| Data | Postgres (SoT) · Qdrant (vectors) · Redis (queues) · MinIO (files) | |
| Auth | Argon2id, single-user first-run, multi-user-ready schema | |
| Skill taxonomy | Seeded from ESCO, override-friendly | |
| Code host integrations | GitHub (github.com) + GitLab (gitlab.com public + self-hosted enterprise). Common `CodeHost` interface in `packages/shared`. PAT default; OAuth2 optional. Self-hosted URL gated by per-user host allowlist enforced via `assertPublicUrl` (Wave A A-C2). | See COMPLETION_PLAN.md §Wave C-P1.6 |
| Job source adapters (MVP) | ATS: Ashby + Greenhouse. Aggregators: Adzuna + Remotive + Arbeitnow. Paid optional: JSearch or Serpapi (LI/Indeed via legit partners). | LinkedIn/Indeed direct still out of scope |
| Browser discovery | Companion desktop agent (Electron + Playwright + user's installed Chrome) | Personal-scale only; see [phase-3.5](phase-3.5-desktop-agent.md) |
| Agent distribution | GitHub Releases + `electron-updater`; unsigned for MVP | Mac notarization / Windows EV cert deferred |
| Agent auth | Device-code pairing → JWT + refresh; keys in OS keychain via `keytar` | |
| Slack / Gmail | Deferred to P5. Gmail scope: `readonly`. Slack: personal workspace install. | |
| Code sandbox (P2) | Docker-per-run | Fresh container per attempt, strict resource + network limits |
| Code editor (P2) | Monaco | Native TS support, VS Code fluency |
| Question bank (P2) | LLM-generated, cached, thumbs-down regen | Fits ai-safety golden-eval feedback loop |
| Speech-to-text | `whisper.cpp` local, `whisper-small` English model | Compose service; shared across P2 (verbal defense) + P6 (talk-track practice) |
| Resume PDF/DOCX (P4) | React-PDF + `docx` npm | Component-based templating; ATS-friendly output |
| State machine (P4 pipeline) | XState | Explicit, testable |
| Company reviews (P4) | AmbitionBox + Comparably + Reddit/Blind aggregate | India-relevant + broad; Glassdoor deferred pending partner API |
| Loaders / small spinners | `thinking-orbs` (`<ThinkingOrb state="working" size={20\|64} />`) | Every small loader across the app uses this. `size=20` inline, `size=64` for centerpiece / avatar. No custom spinners, no Loader2 icons |
| Brand / tech logos | `@icons-pack/react-simple-icons` via `apps/web/src/lib/skill-icon.tsx` | Map skill IDs to Simple Icons brand logos. `<SkillIcon skillId="react" size={18} tone="brand" />`. Fall back to 2-letter initials when no logo (Java → OpenJDK, C# → .NET, plain SQL → Postgres). |
| Boss battle timer (P2) | Server-authoritative | Client shows countdown, server enforces |
| Playwright allow-list format | YAML under `packages/browser-agent/allowlist/` | Shared between server + agent |
| Retry policy | Exponential + jitter, 3 attempts default | Standard `packages/shared/retry.ts` |
| DB pooling | Prisma default; pgBouncer optional at scale | YAGNI until measurable pressure |

## Working defaults (flag to override)

- Assessment questions: LLM-generated at runtime, cached, thumbs-down triggers regen.
- Repo analysis depth (P1): metadata + tree-sitter for top-N repos only, deep pass on demand.
- LinkedIn / Indeed: excluded until authorized access; UI shows "unavailable, use ATS sources".
- Testing bar: unit tests for engines and scoring; Playwright e2e for install wizard + one golden flow per phase.
- Company name/brand: working title **"Career OS"** until you rename it.
- Repo layout: monorepo (`apps/web`, `apps/api`, `apps/worker`, `packages/*`) per blueprint §29.12.

## Cross-cutting rules (every phase)

- Evidence + source + timestamp on every claim shown to user.
- Resume / cover-letter generation may only rephrase verified facts.
- Every outbound action → approval queue + audit log.
- Every LLM call → structured output (Zod schema), sensitivity-labeled context, no employer-confidential code sent by default.
- Every screen: pixel-perfect against `frontend-design` guidance; check dark + light; check reduced-motion.
- Every merged phase: updated README section, one Playwright golden-flow test, one screenshot in `/plan/screenshots/`.
- Every job — regardless of source (ATS, aggregator, agent, email) — passes through the same `packages/job-pipeline` funnel: normalize → dedupe → freshness → skill-extract → verify → relevance → match. No source bypasses. Every reject records a reason viewable in the audit UI.
- Every security-sensitive change must satisfy the relevant item in [`security.md`](security.md) with acceptance criteria ticked AND a regression test.
- Every LLM call, agent, and generated artifact must satisfy the relevant item in [`ai-safety.md`](ai-safety.md) — grounded generation, structured output, untrusted-content wrapping, sensitivity gate, audit log, evals.
- Every phase checkbox has at least one verifying test per [`testing.md`](testing.md); the phase's Playwright golden flow must pass in CI before status flips to Done.
- Every release follows [`release-process.md`](release-process.md) — semver, signed commits + images, SBOM, changelog entry, one-command upgrade.

## Phase status board

| Phase | Focus | Status | File |
|---|---|---|---|
| P0 | Install & first-run wizard | In progress (Wave A 20 of 20 findings shipped; C-P0 7 of 8 streams shipped: C-P0.1 AIProvider registry, C-P0.2 prompt registry + CI gate, C-P0.3 wrapUntrusted + sensitivity, C-P0.4 packages/testing + msw + fast-check + storage-state helpers, C-P0.5 CI pr + restore + nightly-evals + tag-release workflows, C-P0.7 passkey + recovery, C-P0.8 backup + restore + cron scripts + docs; docker infra fixes (minio user/healthcheck, squid tmpfs); setup wizard + security headers + session revocation + CSRF double-submit all green. C-P0.6 first-run failure recovery + Playwright golden flow DEFERRED — see plan/DEFERRED.md.) | [phase-0-install.md](phase-0-install.md) |
| P1 | Personal intelligence (candidate twin) | In progress (slices 1-8 shipped + verified + C-P1 6 of 6 streams shipped: C-P1.1 commit-analysis (language-detect + framework-hints + orchestrator + wire), C-P1.2 learning_priority formula end-to-end, C-P1.3 ESCO seed 188 skills + skill_fact + fact_base, C-P1.4 skill-extract evals (20+ fixtures + runner + judge + eval script), C-P1.5 Prisma 6 + $extends migration + pg_dump opacity test, C-P1.6 GitLab integration public + self-hosted (PAT + safeFetch + SSRF regression tests). See phase-1 file for slice-level partials (full-wizard Playwright storage-state, prompt-per-usage evidence_refs schema).) | [phase-1-personal-intelligence.md](phase-1-personal-intelligence.md) |
| P2 | Assessment arena | In progress (slices 1-12 + C-P2 7 of 8 streams shipped: C-P2.1 packages/sandbox skeleton + docker wrapper + pool + kill-switch, C-P2.2 sandbox security tests (memory/network/fork/wallclock/fs/tmpfs/kill-switch/caps), C-P2.3 Monaco CodeEditor + drafts hook + language auto-detect, C-P2.4 build-code sandbox consumer wire in assessments.service (`71e7d8a`, replaces the `751307e` TODO), C-P2.6 quest generator + prereq graph + controller, C-P2.7 corpus adapters (tech-interview-handbook + every-programmer-should-know) + cosine dedupe + refresh worker + weekly cron + prisma embeddingId, C-P2.8 agents (registry + orchestrator + eval-set helper). C-P2.5 partial: grader agents + mock-interview grader/runner shipped (`522932d`); verbal + multi-turn still pending on the `verbal_sessions` table + `whisper.cpp` compose service.) | [phase-2-assessment-arena.md](phase-2-assessment-arena.md) |
| P3 | Market engine | In progress (slices 13-18 + C-P3 8 of 8 streams shipped: C-P3.1 ATS + aggregator adapters (ashby/greenhouse/adzuna/arbeitnow) + registry + jobs.service wire, C-P3.2 verify stage + trust-order + cross-source dedupe + job_reject_log + controller, C-P3.3 seniority + role + comp classifier + FX, C-P3.4 market_snapshot + snapshot service + controller + weekly cron, C-P3.5 screens 33 + 56, C-P3.6 adapter contract tests + weekly cron + shape-diff, C-P3.7 wrapUntrusted on jobs + market-brief + resume-extract + dossier, C-P3.8 requireAdmin guard + decorator + tests. N+1 in JobsService.sync + match-score pagination pool ceiling parked as debt.) | [phase-3-market-engine.md](phase-3-market-engine.md) |
| P3.5 | Desktop companion agent | In progress (Wave D 7 of 8 streams shipped: D.1 packages/browser-agent skeleton + pacing + allowlist + kill-switch + selector-health + tests, D.2 migrations + pair endpoints + WSS gateway + rate limits + audit_log + tests, D.4 Electron scaffold + task-runner (`f65cd96`, `e6ec584`), D.5 linkedin-selectors + linkedin-parse + linkedin-discover Playwright script + probe + README, D.6 packaging (electron-builder + updater, `4746494`), D.7 JWT scope refinement (via D.2), D.8 ops (proxy + screenshot cleanup + log rotation, `4746494`). D.3 web downloads + Settings→Devices remains web-owned/pending.) | [phase-3.5-desktop-agent.md](phase-3.5-desktop-agent.md) |
| P4 | The hunt (jobs, matching, resume studio) | In progress (slices 19-23 + C-P4 6 of 8 streams shipped: C-P4.1 matcher service + controller, C-P4.2 unified ResumeDoc + DOCX renderer + templates + tests, C-P4.4 company dossier pipeline (identity → tech signals → reviews → interviews → events → synthesis) + controller + tests, C-P4.7 fact-check gate extract + wire (market-brief + resume-variants + cover-letters + dossier) + evals, C-P4.8 metrics service + prom-client + /metrics + pino + LLM + Prisma hooks. C-P4.3 diff UI DEFERRED, C-P4.5 application detail + timeline DEFERRED (web-owned), C-P4.6 screens 36-44 DEFERRED (web-owned).) | [phase-4-the-hunt.md](phase-4-the-hunt.md) |
| P5 | Daily assistant (Slack + Gmail) | In progress (Wave E 7 of 9 streams shipped: E.2 Slack Events API + signing + dedupe + slash commands + Block Kit + OAuth + controller + manifest + docs, E.3 daily-brief composer + tz-aware scheduler + prefs/enable/snooze/preview/latest endpoints (`33864cd`), E.4 Gmail prisma models + JWT verify + Gmail service (oauth + watch + history-diff) + controller + push endpoint + oauth callback + watch renewal worker + cron, E.5 email classifier + 27 fixtures + evals (`299fabd`), E.6 email-parsers package (linkedin/indeed/naukri) + fixtures + evals + ingest service + wrapUntrusted + queue consumer, E.7 email→application fuzzy match + inbox triage backend + Prisma models + endpoints (`4fc6b40`), E.9 packages/messaging Channel interface + Web channel + stubs (`cbd6dcd`). E.1 install docs still pending (E.2d ships partial docs); E.8 partial via E.6 wrapUntrusted. Follow-ups: Slack push wire (slack module), classifier → email-ingest wire, screen 50 inbox UI (web-owned).) | [phase-5-daily-assistant.md](phase-5-daily-assistant.md) |
| P6 | Controlled execution + hardening | In progress (Wave F 8 of 11 streams shipped: F.1 approval queue + state machine + controller + bulk-threshold + re-auth + tests, F.2 ATS submit adapters (Ashby/Greenhouse) + multipart + msw contract + approval wire (`4a1b6f5`, `492f1ff`), F.3 agent form-fill scripts + allowlist + selector-health (`9d0f60c`), F.4 interview prep + talk-track + fact-check (`c47c5a8`), F.5 outreach composer + 5 templates x 4 variants + timing + fact-check (`971ddd3`), F.6 audit_log append-only DDL + retention worker + append-only integration test + docs, F.8 data portability (/me/export + /me/delete + parity) + age-encrypted MinIO export round-trip (`5a800b0`, `e71b28c`), F.9 Advanced Usage & Costs dashboard backend (`d996216`). F.7 backup + restore CI partial via C-P0.5b + C-P0.8. F.11 requireAdmin guard + webhook rate limits partial via C-P3.8 + F.11a/F.11c. F.10 screens 45/46/47/48/57/59/60/63/64 (web-owned) still deferred.) | [phase-6-controlled-execution.md](phase-6-controlled-execution.md) |

## Cross-cutting specs

| Spec | Purpose |
|---|---|
| [security.md](security.md) | 6 pillars, threat model, 10 security items with acceptance criteria, phase coverage |
| [ai-safety.md](ai-safety.md) | Hallucination, prompt injection, agent boundaries, sensitivity, evals — 10 items with acceptance criteria |
| [testing.md](testing.md) | Testing pyramid, 10 test types with acceptance criteria, LLM eval pattern, CI structure, phase coverage |
| [observability.md](observability.md) | Logs (pino), metrics (Prometheus), errors (GlitchTip), health, redaction, phase coverage |
| [release-process.md](release-process.md) | Semver, upgrade contract, migration rules, signing, SBOM, release checklist |

## Phase gating (definition of "done")

A phase is done only when **all** of the following are true:

1. Every checkbox in the phase file is ticked.
2. The phase's golden-flow Playwright test passes in CI.
3. The phase's screens have been through `frontend-design` review.
4. Blueprint §"Definition of Done" bullets for that phase's scope are met (see blueprint §24, §29.13).
5. Phase status in this file is flipped to **Done** with the date.

## How we track progress

- **Persistent tracking** = these `plan/*.md` files. Ticked checkboxes = truth.
- **Session tracking** = TaskCreate/TaskUpdate for the in-flight tasks of the current session.
- When a task ships, tick the box in the phase file **and** update this master board's status column.
- Anything not in a phase file? Add it to the phase file first, then build. No orphan work.

## Open questions (parked)

- Product final name? (working: "Career OS")
- OSS-public release or personal-only? (affects docs/install polish)
- Backup destination for VPS (S3? Backblaze? rsync to laptop?)
- Domain name + TLS provider (Let's Encrypt assumed)
- **Companion mobile app** — parked for post-web-MVP. Needs its own scoping session:
  scope (read-only briefing + streaks + approvals vs. full app?), native vs.
  React Native vs. Capacitor-wrap-of-web, auth (device-code pairing like the
  desktop agent? passkey?), push (Slack already covers daily brief, so what
  uniquely needs push?), offline story, distribution (App Store / TestFlight /
  self-signed), and what the P0 wizard would look like from a phone. Pick this
  up once P0-P6 are done; do not start work until scope + platform choice are
  agreed and captured as a new phase file (`plan/phase-7-mobile.md`).
