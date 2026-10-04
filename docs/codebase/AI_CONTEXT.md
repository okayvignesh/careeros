---
commit: ca74dc5
generated: 2026-10-04
scope: compact AI context brief
---

# Career OS — AI Context Brief

> Compact, self-contained brief for injecting Career OS knowledge into any AI/agent context. Generated from commit `ca74dc5` (2026-10-04, branch `feat/remaining-work`; Waves A–C history still at `d31dead` 2026-10-03). For detail, follow the pointers to `docs/codebase/*.md`. `[TODO]` = not determinable from source; `[ASK USER]` = needs team intent.

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

- **Language/runtime:** TypeScript, Node >= 20, pnpm 9.12, Turborepo. License **AGPL-3.0-or-later**.
- **Web:** Next.js 16.3.6 + React 19.3 (App Router, Tailwind, custom `packages/ui` primitives).
- **API:** NestJS 10 (`@nestjs/platform-express`), 50 modules registered (43 feature), Prisma 6.19 (`apps/api/prisma/schema.prisma`, 57 models, 41 migrations, no Prisma enums), Zod at all trust boundaries, `helmet` + Redis-backed `@nestjs/throttler`, `iron-session` cookies, Argon2id, WebAuthn passkeys, active-session management (`/auth/sessions`), OpenAPI JSON + Swagger UI (`@nestjs/swagger` + `@asteasolutions/zod-to-openapi`).
- **Workers:** Node + BullMQ on Redis.
- **Data:** Postgres (system of record), Redis (queues/cache), Qdrant (vectors), MinIO (files).
- **AI:** `packages/ai` provider abstraction with real DeepSeek, OpenAI/OpenRouter, and Ollama adapters + a primary→backup→Ollama fallback chain (5-failure circuit breaker); `chatStructured<T>({schema})` + Zod; `js-tiktoken` pre-flight token estimate; versioned prompts; grounding/injection/sensitivity modules; evals via Vitest.
- **Embeddings:** `packages/embeddings` provider seam — default local `Xenova/bge-small-en-v1.5` via `@xenova/transformers`, deterministic SHA-256 fallback offline, **or a shipped OpenAI-compatible `/embeddings` adapter**. Effective mode/model/dimension resolve from `app_config` (env fallback), the external key is sealed with `@careeros/secrets`, and Qdrant collections recreate on a dimension change.
- **Desktop:** Electron 31 + Playwright (user's installed Chrome) + `keytar`; WSS pairing; devices UI on the web.
- **Mobile:** Expo (React Native SDK 57) + expo-router + expo-secure-store; read-only daily brief/jobs/approvals/settings over REST.
- **Deployment:** Docker Compose; nginx TLS entrypoint + certbot + `ops`-profiled age-encrypted backup sidecar; Squid deny-by-default egress proxy; private datastore network.

**Reality checks:** the embedding provider seam is real (local `bge-small-en` + deterministic fallback + a shipped OpenAI-compatible external adapter resolved from `app_config`); LLM adapters ship for DeepSeek/OpenAI-compatible/Ollama with a fallback chain (Anthropic/Azure still absent); nginx/TLS/certbot/backup/GlitchTip/whisper.cpp are in compose; `@careeros/messaging` is wired through `ChannelRegistry` and builds outbound MIME; Gmail drafts/sends, Slack commands/events/interactive, the outreach approval→draft→send lifecycle, P2 verbal sessions, repository analysis, active-session management, and browser-agent multi-step apply flows are real; Prisma is aligned on 6.x across api/worker/aggregator; Swagger/OpenAPI, `undici`-enforced egress, `llm_calls`/`llm_injection_log` audit, and master-key rotation are real.

## Structure

```
apps/      web (Next.js) · api (NestJS) · worker (BullMQ) · desktop (Electron) · mobile (Expo/RN)
packages/  ai · shared · job-pipeline · aggregator · firecrawl · embeddings · auth · secrets ·
           browser-agent · email-parsers · resume-render · sandbox · messaging · ui · testing
infra/     docker (incl. Dockerfile.backup) · nginx · postgres · slack
plan/      PLAN.md + phase-N-*.md + security/ai-safety/testing/observability/release specs
docs/      architecture.md + operator docs + blueprint .docx
AGENTS.md  durable editing rules (read before writing code)
```

Entry points: API `apps/api/src/main.ts`; web `apps/web/src/app/layout.tsx`; worker `apps/worker/src/main.ts`; desktop `apps/desktop/src/main.ts`; mobile `apps/mobile/src/app/_layout.tsx`; schema `apps/api/prisma/schema.prisma`.

## Architecture in one paragraph

Layered + feature-modular monolith. nginx terminates TLS; Browser → Next.js middleware setup-gate → NestJS controllers → domain services → `packages/*` capabilities → Postgres/Qdrant/Redis/MinIO. The Expo mobile app and desktop agent call the same REST/WSS API. Async work is BullMQ jobs registered by a shared `registerWorker` helper in `apps/worker`. LLM calls are built from versioned prompts, loaded through `ProviderLoaderService` (budget → config → single `SensitivityGateService` → decrypt → primary/backup/Ollama fallback), return schema-validated output, are audited to `llm_calls` (with injection flags to `llm_injection_log`), and (for generated content) pass a fact-check gate before rendering. Embeddings go through one `EmbeddingProvider` seam and one `loadResolvedEmbeddingConfig` resolver (`packages/embeddings/src/config.ts`) that API search, the worker, and Qdrant collection creation all read. Job ingestion is source-agnostic: `normalize → dedupe → cross-source dedupe → freshness → skill-extract → verify → relevance → match`, with `JobRejectLog` on every reject. The match scorer is canonical in `packages/job-pipeline/src/stages/match.ts` (list and detail agree); skill-state sync is `@careeros/aggregator`; approvals fail loud on an unhandled kind, and `OutreachService` registers as an `ApprovalsWorker` so an approved outreach stages a Gmail draft (then the delayed `outreach-send` worker flushes it). Browser-agent apply flows are declarative YAML (`apply_flow`) driven by `packages/browser-agent/src/scripts/apply-flow.ts`.

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

No global auth guard (per-controller `requireUserId`); `AppConfig` not user-scoped (multitenant TODO); live Docker egress smoke not yet run; GlitchTip and `whisper.cpp` are in compose but the web `@sentry/nextjs` instrumentation, P6 talk-track practice UI, and a verbal-recording retention sweep are still open; mobile push/offline and desktop signing still open; prompt evals thin and unregistered. The embedding placeholder and external-adapter gap, single-provider limit, messaging orphan, mock fixtures, desktop devices UI, agent form-fill + multi-step apply flows, P2 `verbal_sessions` consumer, T29 web fetch-on-mount warnings, web UI backlog routes, Gmail/Slack/outreach realness, repository analysis, active-session management, nginx/TLS/backup, `llm_calls`/`llm_injection_log` audit, and master-key rotation are resolved. Full list and the `[ASK USER]` decisions are in `CONCERNS.md`.
