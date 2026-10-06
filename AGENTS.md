# Career OS — Agents Guide

**Read this before writing any code.** This is the durable spec any AI agent (Claude Code, Cursor, Copilot, future models) works from. If you edit the codebase and this file no longer describes reality, update this file in the same commit.

---

## 1. What Career OS is

A self-hosted, provider-agnostic **Personal AI Career Operating System**. Single-user by default, multi-user-ready by schema. Builds a continuously updated *digital twin* of one candidate — resume + GitHub + assessments + market signals + application outcomes — and drives daily learning + job execution from it.

**Core principle (never violate):** The AI is **not** the source of truth. The Postgres evidence graph is. Models interpret evidence, generate tests, and propose actions.

---

## 2. Where to find things

| Need | Location | Authoritative for |
|---|---|---|
| Product spec | `docs/personal_ai_career_os_blueprint_v1_2_self_hosted_provider_agnostic.docx` | **What** the product does |
| Architecture diagrams | `docs/personal_ai_career_os_blueprint_rendered_diagrams.docx` | Visual architecture reference |
| Implementation plan | `plan/PLAN.md` | **When** + **how** — stack, decisions, phase gates |
| Per-phase checklists | `plan/phase-N-*.md` | Task-level source of truth |
| Security spec | `plan/security.md` | Threat model, 10 security items, acceptance criteria |
| AI safety spec | `plan/ai-safety.md` | Hallucination, injection, agent boundaries, sensitivity, evals |
| Observability spec | `plan/observability.md` | Logs, metrics, errors, health, redaction |
| Release process | `plan/release-process.md` | Semver, upgrade contract, signing, SBOM, changelog |
| End-to-end architecture | `docs/architecture.md` | Topology + data lifecycles + golden-path sequences + "what happens when X" FAQ |
| Dev setup | `docs/dev-setup.md` | Clone → run in 10 minutes |
| Wireframes | `careeros-screens/` (open `index.html`) | Information architecture + flow — **visual only, not final design** |
| This file | `AGENTS.md` | Rules for agents working on the code |

**Conflict resolution:** blueprint wins for domain/product; plan wins for stack/build decisions; if both conflict, ask the user.

---

## 3. Non-negotiable rules

These are load-bearing. Break one, break the product.

1. **Evidence, not claims.** Every skill state, market signal, or company fact shown to the user carries an evidence reference with source + timestamp. No timeless facts.
2. **Never invent facts in generated content.** Resume variants, cover letters, and outreach messages may only rephrase verified facts from `resume_facts` / evidence graph. Any output that references a claim without a fact ID is blocked at the fact-check gate.
3. **Approval queue + audit log for every outbound action.** Applications, emails, Slack messages, ATS submissions — nothing sends without approval and nothing is untraceable.
4. **Scrape only what is authorized.** **Owner decision (2026-10-06):** LinkedIn / Indeed / Naukri / Glassdoor may be **discovered and scraped via Firecrawl** (`@careeros/firecrawl` `search` + `/v1/scrape`). They remain banned for (a) any **direct first-party scraping** by our server (no bespoke HTTP adapters) and (b) **non-Firecrawl third-party scrapers** (Apify or similar) — outsourcing a ToS violation to anything other than the approved Firecrawl path does not launder it. Partner APIs (JSearch, Serpapi), the user's own desktop agent session (P3.5), and parsed email alerts (P5) all remain valid alternatives. **Also permitted (owner decision U6):** Firecrawl and direct crawling of *public* company career sites and ATS boards — Workday, Lever, SmartRecruiters, Workable, iCIMS, SuccessFactors — provided robots.txt and each site's ToS are respected and rate limits are honored (shared retry/backoff + per-host pacing). Discovery should prefer Firecrawl; direct crawl targets are explicitly allowlisted in `infra/docker/squid/squid.conf`. The operator remains responsible for compliance. See [`docs/job-sources.md`](docs/job-sources.md) for sources, trust tiers, and the robots/ToS + rate-limit policy.
5. **Every job flows through one pipeline.** All sources — ATS, aggregators, agent, email — funnel through `packages/job-pipeline`: normalize → dedupe → freshness → skill-extract → verify → relevance → match. No source bypasses. Every reject logs a reason.
6. **Sensitivity labels on data.** Tag every stored object `public | personal | confidential | employer-confidential`. Never send employer-confidential code to an external model by default. Redact secrets before embedding.
7. **Structured LLM output only when consumed downstream.** Use Zod schemas end-to-end. If an LLM response is parsed by code, it must be structured; never regex-parse prose.
8. **Human approval before irreversible external actions** in every version — MVP through v1.
9. **Store the reason for every skill-state change.** The knowledge aggregator must log *why* proficiency or confidence moved so users can audit.
10. **Two skill values, not one:** `historical_demonstrated_proficiency` (what evidence has ever shown) and `current_readiness` (adjusted for recency/decay). Never collapse them.

---

## 4. Stack (locked — see `plan/PLAN.md` for the full decision table)

| Layer | Choice |
|---|---|
| Frontend | Next.js 15 (App Router) + TypeScript strict + Tailwind + shadcn/ui |
| Backend | NestJS + TypeScript strict |
| Workers | Node + BullMQ |
| Data | Postgres (system of record) · Qdrant (vectors) · Redis (queues/cache) · MinIO (files) |
| ORM | Prisma (or Drizzle — one, note in PLAN when picked) |
| LLM | DeepSeek default, provider-agnostic via `packages/ai/AIProvider` |
| Embeddings | Local `bge-small-en` via `@xenova/transformers` (default) |
| Auth | Argon2id + HttpOnly Secure SameSite cookie |
| Secrets | AES-GCM, master key from env, never in DB |
| Desktop agent | Electron + Playwright + user's installed Chrome; keychain via `keytar` |
| Deployment | Docker Compose on a VPS, nginx public-facing, Let's Encrypt / Caddy |
| Package manager | pnpm workspaces + Turborepo |
| Design direction | Linear / Vercel — minimal, dense, dark-first, mono accents |

---

## 5. Repo layout

```
career-os/
├── apps/
│   ├── web/              Next.js — user-facing app
│   ├── api/              NestJS — HTTP API (MinIO wrapper: apps/api/src/common/storage.service.ts; GitHub integration: apps/api/src/modules/integrations/github/)
│   ├── worker/           BullMQ workers (GitHub sync: apps/worker/src/github-sync.ts)
│   └── desktop/          (from P3.5) Electron desktop companion
├── packages/
│   ├── ai/               AIProvider abstraction + adapters
│   ├── embeddings/       Local + external embedding adapters
│   ├── auth/             Argon2id + session helpers
│   ├── secrets/          Encryption service
│   ├── ui/               Design system (shadcn wrap + primitives)
│   ├── shared/           Zod schemas + types + constants
│   ├── job-pipeline/     (from P3) source-agnostic ingestion funnel
│   ├── aggregator/       (from P3) aggregator source adapters
│   ├── firecrawl/        (from P3) public career-site / ATS discovery client
│   ├── email-parsers/    (from P5) email-alert parsers (linkedin/indeed/naukri)
│   ├── messaging/        (from P5) Channel interface + Web/Slack stubs
│   ├── resume-render/    (from P4) ResumeDoc + DOCX/PDF renderers
│   ├── sandbox/          (from P2) Docker-per-run code sandbox
│   ├── testing/          test infra (msw, fast-check, storage-state helpers)
│   └── browser-agent/    (from P3.5) pacing + kill-switch + task schema
├── infra/
│   ├── docker/           compose files + per-service Dockerfiles (incl. Dockerfile.backup)
│   ├── nginx/            reverse proxy + TLS (nginx.conf, templates/, self-signed.sh, README)
│   ├── postgres/         init scripts
│   └── slack/            Slack app manifest
├── scripts/              backup/restore/cron, dev-host, verify-* (repo root, not infra/)
├── plan/                 implementation plan (living)
├── docs/                 blueprint DOCX
├── careeros-screens/     wireframes (visual reference only)
├── AGENTS.md             ← you are here
└── README.md             quickstart + VPS deploy
```

Adapter modules go in `packages/*`. Domain logic goes in `apps/api` NestJS modules. Never import an adapter from `apps/web` directly — always through a stable interface in `packages/`.

---

## 6. Coding conventions

- **TypeScript strict** everywhere. `noImplicitAny`, `strictNullChecks`, `exactOptionalPropertyTypes` on. No `any` unless there's a written reason next to it.
- **Zod at trust boundaries** — every HTTP request, every LLM response, every external API response. Nowhere else.
- **No comments explaining what code does.** Only comment *why* when non-obvious. `ponytail:` prefix for deliberate simplifications ("`// ponytail: global lock, per-account locks if throughput matters`").
- **Prefer deletion over addition.** If two implementations exist, keep the smaller one.
- **Small focused modules.** One responsibility per file. If a file passes ~200 lines, ask if it should split.
- **Reuse before rewrite:** check `packages/ui`, `packages/shared`, shadcn, lucide, stdlib before writing.
- **No unrequested abstractions.** No interface with one implementation. No factory for one product. No config for a value that never changes.
- **Prisma migrations must be named descriptively** (`add_evidence_source_column`, not `migration_20260921`) and reviewed before merge.
- **Never overwrite raw source data.** `jobs_raw` is append-only. Normalization derives from it. Same for `evidence` — new records, not mutations.
- **Idempotency** on every worker job. Use a stable `jobId` when enqueuing.

### Timezone

- **All timestamps stored in UTC.** Every DB column that holds time is `timestamptz`; every ISO string is UTC.
- **User's timezone lives in `user_prefs.timezone`** (IANA name, e.g. `Asia/Kolkata`). Auto-detected from browser at wizard, editable in settings.
- **Rendering:** always `Intl.DateTimeFormat(user.timezone)` — never format on the server.
- **Scheduling** (daily brief, freshness gate, market brief cron): server converts user's local wall-clock time to UTC using `date-fns-tz` or equivalent. Never assume server's local zone.
- **DB queries with "today":** always parameterize with user's UTC-window based on their timezone.

### Retry & backoff

- All external calls (LLM, ATS APIs, GitHub, Slack, Gmail, aggregators, MinIO, cross-service) go through `packages/shared/retry.ts`.
- Default policy: exponential with full jitter, base 500ms, factor 2, max 30s, max 3 attempts.
- Per-error-class overrides:
  - `429` → respect `Retry-After`, then default
  - `5xx` → default policy
  - `4xx` (not 429) → no retry, fail fast
  - Network / DNS → default policy
  - Idempotency-key required for any retryable POST
- Circuit breaker at 5 consecutive failures per (provider, endpoint) — 60s open state, half-open probe.
- Every retry logs `warn` with attempt N + reason.

### Rate limiting per external API

- Every adapter declares its provider's limits in `packages/shared/rate-limits.ts` (calls/min, calls/hour, token-buckets where applicable).
- BullMQ workers respect via `limiter: { max, duration }` per queue.
- Shared budget across replicas via Redis (`bottleneck` or `p-limit` with Redis store).
- Known limits committed:
  - GitHub: 5000/hr authenticated, 60/hr unauthenticated
  - DeepSeek: per-account, provider-declared (updated from `packages/ai/pricing.ts` sheet)
  - Ashby / Greenhouse: unauthenticated public boards ~60/min
  - Adzuna: 1 req/sec on free tier
  - Slack: 1/sec per channel (Web API tier 3)
  - Gmail: 250 quota units/sec/user

### Observability

- All logs go through `pino` (see [`plan/observability.md`](plan/observability.md)).
- Never `console.log` in application code — ESLint blocks it.
- Metrics on `/metrics` (Prometheus format) on api + worker.
- Errors ship to self-hosted GlitchTip; PII scrubbed via `packages/shared/redact.ts`.
- No OpenTelemetry / tracing in MVP; interface reserved.

### API documentation

- NestJS `@nestjs/swagger` decorators on every controller.
- OpenAPI JSON served at `/api/openapi.json`; Swagger UI at `/api/docs` (behind auth in production).

### Feature flags

- YAGNI for MVP (single-user tool). If needed later, use `flipt` or a simple `feature_flags` table.

### i18n / a11y

- **i18n:** English-only for MVP. No `i18next` unless we ship a locale.
- **a11y:** every frontend component keyboard-navigable; visible focus rings; `axe-core` runs in Playwright golden flows; WCAG 2.1 AA target.

---

## 7. LLM usage rules

- Always go through `packages/ai` — never import DeepSeek SDK directly from a NestJS module.
- Every prompt template lives in a versioned `.prompt.ts` file with a schema attached.
- Structured output uses Zod → JSON Schema → provider's structured mode.
- Log the prompt hash, model, token counts, and cost estimate for every call (`llm_calls` table).
- **Context minimization:** send only what the task needs. Never dump the whole candidate profile if the task only needs three skills.
- **Sensitivity gate:** before sending, check the sensitivity label of every item in the prompt. Employer-confidential = block by default, requires per-call opt-in.
- **Streaming is opt-in.** Only wizard capability tests and long-form generations stream; APIs consumed by code should batch.

---

## 8. UI rules

- **Design direction:** Linear / Vercel — minimal, dense, dark-first with light override, mono accents, tight radii, subtle borders. Solo-Leveling progression exists in the mechanics, never in the chrome.
- **Every screen passes through `frontend-design`** skill guidance before merge. Do not port the wireframe visuals verbatim — the `careeros-screens/` files are for **information architecture and flow only**.
- Consistent primitives from `packages/ui`. If you find yourself styling a raw `<button>`, stop and use `<Button>`.
- Respect `prefers-reduced-motion` — motion layer must collapse cleanly.
- Every interactive element needs a keyboard path. Focus rings are visible.
- Loading states via skeleton, not spinners, except for < 300ms actions.
- Toast for non-blocking feedback. Dialog for decisions. Never both for the same event.
- Screenshot every merged screen into `plan/screenshots/phase-N/` for regression reference.

---

## 9. Testing conventions

Full spec: [`plan/testing.md`](plan/testing.md). Quick rules:

- **Vitest** for unit + integration. Colocate as `foo.test.ts` next to `foo.ts`.
- **Testcontainers** for integration tests. Real Postgres/Redis/Qdrant/MinIO — never mock the DB.
- **Playwright** for e2e + visual + a11y. One golden-flow spec per phase — that's what CI gates on.
- **`msw`** for external HTTP mocks in unit tests only.
- **`fast-check`** for property-based tests on math-heavy paths.
- **LLM evals** via custom runner in `packages/ai/evals/<prompt>/`; never assert exact strings.
- **Ponytail rule:** any non-trivial module (branch, loop, parser, money/security path) leaves ONE runnable check.
- **Data-testid** for every interactive element. Never CSS selectors, XPath, or text-match in e2e.
- **Retries: 0.** Flakes are bugs.
- **No coverage %.** Behavior coverage: every phase checkbox has at least one verifying test.
- CI gates: typecheck + lint + unit + integration + Trivy + Playwright golden flow + a11y + affected LLM evals + audit + CodeQL.

---

## 10. Security

- Passwords: Argon2id only. Never SHA/bcrypt/plain.
- Sessions: HttpOnly, Secure, SameSite=Lax. Rotate on privilege change.
- All external API keys + OAuth tokens: encrypted at rest via `packages/secrets` (AES-GCM). Master key from `ENCRYPTION_KEY` env, never in DB.
- Master key backup is a required setup step. Loss = encrypted creds unrecoverable.
- Redact secrets, API keys, passwords, tokens **before** any text is indexed or sent to an LLM. Use a shared redaction pass in `packages/shared/redact`.
- Rate-limit every public endpoint. Pairing endpoints get the tightest limit (5/hour/IP).
- Only nginx bound to the public network. Postgres/Redis/Qdrant/MinIO on the private Docker network only.
- Per-integration OAuth scopes = least privilege. Never request `repo` when `public_repo` suffices.

---

## 11. The evidence model (memorize this)

Every skill has this shape:

| Field | Meaning |
|---|---|
| `proficiency` | Demonstrated ability, 0–100. Updated by evidence. |
| `confidence` | How reliable the proficiency estimate is (%). Lowered by contradictory evidence *before* proficiency swings. |
| `historical_demonstrated_proficiency` | Best-observed evidence ever. Never decays. |
| `current_readiness` | Recency-adjusted. Decays when unused. |
| `evidence_count` | Number of supporting observations. |
| `recency` | Days since last used/tested. |
| `market_demand` | Normalized demand from market engine. |
| `gap` | Distance to target role threshold. |
| `priority` | `learning_priority = market_relevance × role_gap × confidence_adjustment × prerequisite_weight × interview_importance` |

Evidence types: `self | document | code | assessment | behavioral | outcome`. Every evidence row carries source + timestamp + strength estimate.

Update rules (blueprint §5.4) live in `packages/shared/knowledge-rules.ts` — never inline.

---

## 12. The job pipeline (universal, source-agnostic)

Every job — from any source — flows through `packages/job-pipeline`:

```
raw ingest → normalize → dedupe (cross-source) → freshness gate →
skill extract → verify → relevance filter → match score → land
```

Trust order for cross-source merge: `VERIFIED ATS > Aggregator API > Agent (DISCOVERED) > Email alert`.

The pure/injectable stages live in `packages/job-pipeline`: `normalize`, `crossSourceDedupe`, `verify`, `freshness`, `relevance`, and the canonical weighted match scorer `computeMatch` / list projection `computeMatchResult`. `skill-extract` (LLM) and adapter fetch/persist still run inline in the API request path (`POST admin/jobs/sync`, `POST admin/jobs/extract-skills`) pending a persistence port onto a `jobs` BullMQ queue — see the `ponytail:` note on `JobsService.sync`.

Every rejected job writes to `job_reject_log` with a reason code viewable in a "why didn't I see this job?" audit UI.

Only `VERIFIED` jobs may enter the auto-apply queue.

---

## 13. Phase workflow (how to actually work on this repo)

Before writing code:

1. **Which phase are you in?** Check `plan/PLAN.md` status board.
2. **Is your task in the phase file?** If no → add it to the phase file first, then build. No orphan work.
3. **Climb the ladder** (ponytail): does this need to exist → stdlib → native platform → existing dep → one line → minimum code.
4. **Reuse first.** Grep `packages/` before writing new utilities.
5. **Write the check.** Non-trivial logic ships with one `assert`-based `demo()` or one small unit test.

While working:

- Use `TaskCreate` / `TaskUpdate` for in-flight session tracking.
- Tick the checkbox in `plan/phase-N-*.md` **as soon as** a task is done.

After landing:

- Flip the status column in `plan/PLAN.md` when a phase moves.
- Add a screenshot in `plan/screenshots/phase-N/` if you shipped a screen.
- Update `AGENTS.md` if your change alters architecture, conventions, or non-negotiable rules.

---

## 14. Phase reference (one-line each)

| Phase | Focus | Plan file |
|---|---|---|
| **P0** | Install + first-run wizard on VPS | `plan/phase-0-install.md` |
| **P1** | Candidate digital twin — resume, GitHub, evidence graph, skill state | `plan/phase-1-personal-intelligence.md` |
| **P2** | Assessment arena — 8 assessment types, XP, quests, boss battles | `plan/phase-2-assessment-arena.md` |
| **P3** | Market engine — job ingestion pipeline, weekly brief, trend windows | `plan/phase-3-market-engine.md` |
| **P3.5** | Desktop companion agent — Electron + Playwright + device-code pairing | `plan/phase-3.5-desktop-agent.md` |
| **P4** | The hunt — matching, resume studio, cover letters, applications | `plan/phase-4-the-hunt.md` |
| **P5** | Daily assistant — Slack primary, Gmail secondary + email-alert ingest | `plan/phase-5-daily-assistant.md` |
| **P6** | Controlled execution — approval queue, ATS API + agent form-fill, hardening | `plan/phase-6-controlled-execution.md` |

---

## 15. Anti-patterns (things NOT to do)

- **Don't scrape LinkedIn / Indeed / Naukri / Glassdoor directly from our server.** Owner decision (2026-10-06) permits accessing them **through Firecrawl** (discovery + scrape); direct first-party adapters are out. Partner APIs, the desktop agent (user's session), and parsed email alerts remain valid alternatives.
- **Don't outsource scraping of those platforms to non-Firecrawl scrapers (Apify or similar).** Only the approved Firecrawl path is allowed; anything else is still a ToS violation and still yours.
- **Don't invent facts in generated content.** Ever.
- **Don't auto-send outbound anything** without going through the approval queue.
- **Don't put everything in the vector DB.** Structured facts in Postgres, semantic content in Qdrant, files in MinIO, transient state in Redis. Job records, verification state, company profiles = Postgres.
- **Don't send employer-confidential code to an LLM** without an explicit per-call opt-in.
- **Don't build a source adapter for a platform you can't legally access.** Stub it with "unavailable, use ATS sources" in the UI.
- **Don't add features not in the plan.** Add them to the plan first, then build.
- **Don't reimplement what stdlib / shadcn / lucide gives you.**
- **Don't create planning docs or design docs unless the user asks.** Work from conversation context and the plan.
- **Don't skip the frontend-design skill for UI work.** The wireframes are not the design bar.
- **Don't chase XP / gamification metrics** at the expense of proficiency accuracy. XP is a behavior signal; proficiency is capability. Keep them separate.
- **Don't collapse `historical_demonstrated_proficiency` and `current_readiness`** into one number.
- **Don't overwrite raw records** — `jobs_raw`, `evidence`, `llm_calls` are append-only.
- **Don't skip migrations** — never `db.execute("ALTER TABLE...")` in application code. Every schema change is a named migration.

---

## 16. Definition of done (per phase)

A phase is done only when **all** of the following are true (also in `plan/PLAN.md`):

1. Every checkbox in the phase file is ticked.
2. The phase's golden-flow Playwright test passes in CI.
3. The phase's screens have been through `frontend-design` review.
4. Blueprint §"Definition of Done" bullets for that phase's scope are met (see blueprint §24, §29.13).
5. Phase status in `PLAN.md` is flipped to **Done** with the date.
6. `AGENTS.md` updated if the phase changed architecture or rules.

---

## 17. Open questions (parked)

- Product final name (working: "Career OS")
- OSS-public release vs personal-only — affects install/docs polish
- Backup destination for VPS (S3? Backblaze? rsync to laptop?)
- Domain name + TLS provider (Let's Encrypt assumed)
- ORM: Prisma vs Drizzle (decide at start of P0)

---

*Living document. Updated whenever architecture, conventions, or non-negotiable rules change. Last section (parked questions) is the only place stale info is expected — resolve or delete each one.*

<!-- codebase-knowledge-base:start -->
## Knowledge base — keep it in sync

This repository has an AI-readable knowledge base at [`docs/codebase/`](docs/codebase/README.md).

- **Discovery entrypoint:** [`docs/codebase/llms.txt`](docs/codebase/llms.txt) · **compact brief:** [`docs/codebase/AI_CONTEXT.md`](docs/codebase/AI_CONTEXT.md) · **machine manifest:** [`docs/codebase/codebase.index.json`](docs/codebase/codebase.index.json).
- **Whenever you change code, config, dependencies, architecture, or conventions, you MUST update the affected `docs/codebase/*.md` in the same change.** If the change is broad, re-run the `codebase-knowledge-base` skill.
- Treat `docs/codebase/` as reviewed source, not generated output: include it in the PR and review it like code.
- Do not delete this section; it is maintained in place by `codebase-knowledge-base`.
<!-- codebase-knowledge-base:end -->
