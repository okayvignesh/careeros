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
| P0 | Install & first-run wizard | In progress (wizard functional; Wave A hardening shipped A-H1..A-M8 = CSRF/CSP/session/master-key/passwords/pat-scope/multer/egress/rate-limits/image-pins; Wave C-alpha/beta/epsilon shipped C-P0.2 prompt-catalog, C-P0.3 wrapUntrusted+sensitivity, C-P0.5 CI test+restore workflows, C-P0.6 secrets-lint, C-P0.7 passkey+recovery, C-P0.8 backup+restore+cron scripts; docker infra fixes; setup wizard, security headers, session revocation all green) | [phase-0-install.md](phase-0-install.md) |
| P1 | Personal intelligence (candidate twin) | Slices 1-8 shipped + verified (dashboard, skill graph, GitHub ingest, usage/costs, AI safety, embeddings, PII encryption, evals, Playwright, settings-suite screens 52/53/54/62, Redis-cached aggregation, vitest + fast-check tests, expanded a11y). See phase-1-personal-intelligence.md for deferred items (slice 2b commit-ingest, 20+ eval fixtures, full-wizard Playwright storage-state, pg_dump opacity test, Prisma 6 $extends migration). | [phase-1-personal-intelligence.md](phase-1-personal-intelligence.md) |
| P2 | Assessment arena | In progress (slices 1-12 + C-P2.1..C-P2.8 partial. Slices: 5 assessment types + boss battles + corpus ingest walking-skeleton via `runLlmGraderOrFallback`, server-authoritative 30-min timer, L10/25/50/75/100 milestones. Wave C shipped: C-P2.1 packages/sandbox skeleton + docker wrapper + pool/kill-switch, C-P2.2 sandbox security tests (memory/network/fork/wallclock/fs/tmpfs/kill-switch/caps), C-P2.3 Monaco CodeEditor with language auto-detect, C-P2.7 corpus adapters (tech-interview-handbook + every-programmer-should-know) + cosine dedupe + refresh worker + weekly cron + prisma embeddingId column, C-P2.8 agents (in flight). Deferred: verbal / mock-interview multi-turn, sandbox consumer wire.) | [phase-2-assessment-arena.md](phase-2-assessment-arena.md) |
| P3 | Market engine | In progress (slices 13-18 + C-P3.1/C-P3.3/C-P3.6/C-P3.7 shipped. Slices: pipeline + attribution + skill extraction + match score + user prefs relevance filter + freshness gate + weekly market brief (on-demand: stats over prefs-filtered pool → LLM synthesis with URL post-filter → persisted, rendered at /brief with KPIs + sourced sections + raw-stats tables). Wave C shipped: C-P3.1 ATS + aggregator adapters (ashby/greenhouse/adzuna/arbeitnow) + registry + jobs.service wire, C-P3.3 classifier (in flight), C-P3.6 contract tests per adapter + weekly adapter-contract.yml cron, C-P3.7 wrapUntrusted on job descriptions + resume-extract inputs + market-brief sample lines. Verification states, cross-source fuzzy dedupe, reject-audit UI, "what changed" diff defer.) | [phase-3-market-engine.md](phase-3-market-engine.md) |
| P3.5 | Desktop companion agent | Not started | [phase-3.5-desktop-agent.md](phase-3.5-desktop-agent.md) |
| P4 | The hunt (jobs, matching, resume studio) | In progress (slices 19-23 + C-P4.1/C-P4.2/C-P4.4 shipped. Slices: close-the-loop — tailored resume + fact-check gate + cover letter + PDF export + application tracker. Grounded-generation with missing-verdict-drop trust default. Applications state machine (6 states, canTransition guards) + `/applications` page with state badges + "Move to..." dropdowns + attached resume/cover chips + event log per transition. JobsList row: Track / Draft resume / Draft cover / Open. Wave C shipped: C-P4.1 matcher service + controller (score + readiness + gap + explanations), C-P4.2 DOCX render, C-P4.4 company dossier. Version diff, more templates defer.) | [phase-4-the-hunt.md](phase-4-the-hunt.md) |
| P5 | Daily assistant (Slack + Gmail) | Not started | [phase-5-daily-assistant.md](phase-5-daily-assistant.md) |
| P6 | Controlled execution + hardening | Not started | [phase-6-controlled-execution.md](phase-6-controlled-execution.md) |

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
