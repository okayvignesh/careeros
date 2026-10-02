---
commit: dead1a4
generated: 2026-10-02
scope: compact AI context brief
---

# Career OS — AI Context Brief

> Compact, self-contained brief for injecting Career OS knowledge into any AI/agent context. Generated from commit `dead1a4` (2026-10-02, cleanup waves 1-14). For detail, follow the pointers to `docs/codebase/*.md`. `[TODO]` = not determinable from source; `[ASK USER]` = needs team intent.

## What it is

Career OS is a **self-hosted, provider-agnostic Personal AI Career Operating System**. It builds a continuously updated digital twin of one candidate (resume + GitHub + assessments + market signals + application outcomes) and drives daily learning and job execution through Slack/Gmail, with every outbound action gated by an approval queue and every LLM call bounded by a sensitivity gate, cost budget, and audit log.

**Non-negotiable invariants** (do not violate when changing code):
1. The Postgres evidence graph is the source of truth — the AI is not. Models interpret evidence; they never decide what is true.
2. Generated content may only rephrase verified facts from `resume_facts`/evidence; any claim without a fact ID is blocked by the fact-check gate.
3. Every outbound action goes through the approval queue and an append-only audit log.
4. No server-side scraping of LinkedIn/Indeed/Naukri/Glassdoor. Use partner APIs, the user's own desktop agent session, or parsed email alerts.
5. Every job flows through one pipeline (`packages/job-pipeline`); every reject logs a reason.
6. Sensitivity labels (`public|personal|confidential|employer-confidential`) on data; employer-confidential never goes to an external LLM by default.
7. Two skill values, never one: `historical_demonstrated_proficiency` and `current_readiness`.

## Stack (actual, verified)

- **Language/runtime:** TypeScript, Node >= 20, pnpm 9.12, Turborepo.
- **Web:** Next.js 16.3.6 + React 19.3 (App Router, Tailwind, custom `packages/ui` primitives).
- **API:** NestJS 10 (`@nestjs/platform-express`), 38 feature modules, Prisma 6.19 (`apps/api/prisma/schema.prisma`, 55 models, 39 migrations, no Prisma enums), Zod at all trust boundaries, `helmet` + Redis-backed `@nestjs/throttler`, `iron-session` cookies, Argon2id, WebAuthn passkeys, OpenAPI JSON + Swagger UI (`@nestjs/swagger` + `zod-to-openapi`).
- **Workers:** Node + BullMQ on Redis.
- **Data:** Postgres (system of record), Redis (queues/cache), Qdrant (vectors), MinIO (files).
- **AI:** `packages/ai` provider abstraction; **only a DeepSeek adapter exists**; `chatStructured<T>({schema})` + Zod; versioned prompts; grounding/injection/sensitivity modules; evals via Vitest.
- **Desktop:** Electron 31 + Playwright (user's installed Chrome) + `keytar`; WSS pairing.
- **Deployment:** Docker Compose, Squid deny-by-default egress proxy, private datastore network.

**Reality checks:** embeddings are still a SHA-256 placeholder (not `bge-small-en`); only the DeepSeek LLM adapter exists; nginx/TLS, GlitchTip, and whisper are documented but absent from compose; `@careeros/messaging` is orphaned; Prisma is aligned on 6.x across api/worker/aggregator; Swagger/OpenAPI and `undici`-enforced egress are now real.

## Structure

```
apps/      web (Next.js) · api (NestJS) · worker (BullMQ) · desktop (Electron)
packages/  ai · shared · job-pipeline · aggregator · firecrawl · embeddings · auth · secrets ·
           browser-agent · email-parsers · resume-render · sandbox · messaging · ui · testing
infra/     docker · postgres · slack
plan/      PLAN.md + phase-N-*.md + security/ai-safety/testing/observability/release specs
docs/      architecture.md + operator docs + blueprint .docx
AGENTS.md  durable editing rules (read before writing code)
```

Entry points: API `apps/api/src/main.ts`; web `apps/web/src/app/layout.tsx`; worker `apps/worker/src/main.ts`; desktop `apps/desktop/src/main.ts`; schema `apps/api/prisma/schema.prisma`.

## Architecture in one paragraph

Layered + feature-modular monolith. Browser → Next.js middleware setup-gate → NestJS controllers → domain services → `packages/*` capabilities → Postgres/Qdrant/Redis/MinIO. Async work is BullMQ jobs registered by a shared `registerWorker` helper in `apps/worker`. The desktop agent executes Playwright locally and talks to the API over WSS. LLM calls are built from versioned prompts, loaded through `ProviderLoaderService` (budget → config → single `SensitivityGateService` → decrypt), return schema-validated output, are audited to `llm_calls`, and (for generated content) pass a fact-check gate before rendering. Job ingestion is source-agnostic: `normalize → dedupe → cross-source dedupe → freshness → skill-extract → verify → relevance → match`, with `JobRejectLog` on every reject. The match scorer is canonical in `packages/job-pipeline/src/stages/match.ts` (list and detail agree); skill-state sync is `@careeros/aggregator`; approvals fail loud on an unhandled kind.

## Key commands

```bash
pnpm install && pnpm docker:up && pnpm migrate && pnpm dev
pnpm typecheck   # turbo
pnpm lint        # turbo
pnpm test        # vitest run
pnpm test:unit   # unit only
pnpm test:e2e    # Playwright
pnpm test:evals  # LLM evals (EVAL_MOCK=1 default)
```

## Conventions that matter

- TypeScript strict + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`; avoid `any`.
- Zod only at trust boundaries (HTTP, LLM, external APIs).
- All external calls go through `packages/shared/retry.ts` (exp backoff + jitter, 3 attempts, circuit breaker).
- All timestamps UTC; render with `Intl.DateTimeFormat(user.timezone)`.
- All logging through `pino`; never `console.log`; redact secrets via `packages/shared/redact.ts`.
- Tests colocated `foo.test.ts`; integration `*.integration.test.ts` (Testcontainers); no coverage % target — every phase checkbox needs a verifying test; e2e retries: 0.
- Never bypass the approval queue or the fact-check gate.

## Where to look

| Question | Document |
|---|---|
| Big picture + divergences | `README.md` |
| Stack + versions + env | `STACK.md` |
| Layout + entry points | `STRUCTURE.md` |
| How it fits together | `ARCHITECTURE.md` |
| Coding rules | `CONVENTIONS.md` |
| APIs, DBs, secrets | `INTEGRATIONS.md` |
| Tests + CI | `TESTING.md` |
| Risks + open questions | `CONCERNS.md` |
| Non-technical overview | `PUBLIC_OVERVIEW.md` |
| Machine discovery | `codebase.index.json`, `llms.txt` |

## Top risks to keep in mind

Embedding placeholder; only a DeepSeek LLM adapter; docs describe infra still absent from compose (nginx/TLS, GlitchTip, whisper); `@careeros/messaging` orphaned; no global auth guard (per-controller `requireUserId`); `AppConfig` not user-scoped (multitenant TODO); live Docker egress smoke not yet run; T29 web fetch-on-mount warnings. Prisma alignment, egress enforcement, Swagger, build blockers, container hardening, and CI pinning are resolved. Full list and the `[ASK USER]` decisions are in `CONCERNS.md`.
