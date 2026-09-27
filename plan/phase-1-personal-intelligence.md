# Phase 1 — Personal intelligence (candidate digital twin)

**Status:** In progress (slice 8 settings-suite + tests: screens 52/53/54/62 shipped, Redis-cached usage aggregation, composite indexes on `llm_calls`, HNSW config on Qdrant collections, vitest suite reusing `.demo.ts` files, fast-check property tests on the aggregator, expanded axe a11y across 9 P1 screens, DeepSeek+GitHub route-stubbed golden-flow skeleton. Slice 4 Usage & Costs shipped; slice 1 skill graph core landed; slice 2 GitHub ingest MVP wired: worker + BullMQ + language-based presence evidence + auto-sync on connect.)
**Blueprint refs:** §5 (knowledge engine), §6 (skill graph), §7 (GitHub intel), §4 (evidence model)
**Screens in scope:** `careeros-screens/phase-1-personal-intelligence/` (15–19, 21, 51–54, 62)

## Goal
System produces an evidence-backed technical profile from resume + GitHub + user-entered claims. Every skill state can point to its evidence.

## Definition of done
- Skill graph seeded from ESCO taxonomy.
- Every displayed skill traces to at least one evidence record.
- New GitHub repo can be added → analyzed → skills updated within one worker cycle.
- Resume changes propagate to the evidence graph without duplicates.
- Dashboard renders skill tree, recency, confidence, priority — no placeholder data.

## Checklist

### Data model
- [~] Migrations: `skills`, `evidence`, `candidate_skill_state`, `skill_state_events` shipped in `20260923060000_skill_graph_core`; `skill_edges` (prereq), `github_repos`, `github_analyses`, `facts`, `fact_versions` deferred to slices 2/5
- [ ] ESCO seed script (deferred: hand-crafted small list will seed in slice 2 when GitHub ingest emits skill IDs)
- [x] Evidence types enum (`self | document | code | assessment | behavioral | outcome`) in `packages/shared/src/knowledge-rules.ts`

### Skill state engine
- [x] `packages/shared/knowledge-rules.ts` — all 7 update rules from blueprint §5.4 as pure functions:
  - `correctIndependent()` → strong+ (weight 1.0)
  - `correctHinted()` → smaller+ (weight 0.4)
  - `partialCorrect()` → neutral or small+ based on reasoning quality
  - `incorrectWithCorrection()` → knowledge-of-correction only, no proficiency jump
  - `repeatedFailure()` → confidence– + remediation task
  - `sustainedApplication()` → proficiency + confidence up
  - `longInactivity()` → mark rusty, do not decrease historical proficiency
- [x] Evidence-strength weights per type (`EVIDENCE_WEIGHT` in knowledge-rules.ts, overridable per-evidence via `weightHint`)
- [x] `aggregate(evidence[], now, seed)` — folds evidence chronologically, applies rule per event, ends with `longInactivity`
- [x] Historical vs current-readiness split — `historicalDemonstrated` is monotonic; `confidence` + `recencyDays` carry the rust signal
- [ ] `learning_priority = market_relevance × role_gap × confidence_adjustment × prereq_weight × interview_importance` (deferred: needs market data in slice 6 + prereq graph)
- [x] `level(state)` — proficiency × evidence-count × confidence, clamped 1..100
- [x] `gap(state, roleThreshold)` — positive = deficit, negative = surplus
- [x] Confidence-adjustment: `incorrectWithCorrection` + `repeatedFailure` dip confidence before proficiency
- [x] Reason-string returned by every rule; `skill_state_events` table ready to receive them
- [ ] Recompute-on-write + nightly decay worker (deferred: slice 2 BullMQ)
- [x] Rule-by-rule assert-based check in `knowledge-rules.demo.ts` — 14 scenarios pass

### GitHub ingestion & analysis
- [x] GitHub API client (`@octokit/rest`) — used by `apps/worker/src/github-sync.ts`
- [~] BullMQ workers: `github.sync` shipped; `repo.analyze` (clone + tree-sitter) and `commit.scan` deferred to slice 2b
- [ ] Rate-limit honored via `packages/shared/rate-limits.ts` (deferred: single MAX_REPOS=100 page today; add proper 5000/hr governor with slice 2b pagination)
- [ ] Tree-sitter integration (slice 2b)
- [ ] Language allowlist configurable (slice 2b; today unknown languages are dropped via `GH_LANGUAGE_TO_SKILL` map)
- [ ] Commit history scope (slice 2b; today no per-commit fetch)
- [ ] Contributor filter (slice 2b)
- [~] Repo-level evidence: languages emit `presence` evidence today; framework/test/CI/license detection deferred to slice 2b
- [ ] File-level evidence (slice 2b)
- [ ] Commit-level signals (slice 2b)
- [ ] AI-assistance likelihood signals (slice 2b)
- [ ] AI-dependency-risk metric (slice 2b)
- [~] Sensitivity labels: `detail.private` is recorded per repo today; full label enforcement in ai-safety Item 8
- [ ] Local clone strategy (slice 2b)
- [~] Skill-graph seed: hand-crafted ~30-skill ESCO-lite in `apps/worker/src/skills-seed.ts`; full ESCO subset in slice 2b
- [~] GitHub contribution calendar (year heatmap, GitHub-style but Career-OS themed) — fetched via GraphQL `contributionsCollection.contributionCalendar`, cached on `Integration.metadata.contributions`, rendered on the dashboard via `<ContributionHeatmap />`

### Resume & fact base
- [ ] Master fact base schema (versioned, sourced, verified/unverified)
- [ ] Resume re-parse pipeline (append evidence, dedupe)
- [ ] Fact edit history + who-changed-when

### Dashboard composition (screen 15)
- [~] Widgets (top to bottom, dark-first, dense):
  1. [x] Header: current level + XP-to-next bar + streak counter (`LevelHeader`)
  2. [x] Row: 4 KPI cards — Skills tracked · Evidence rows · Repos analyzed · Facts verified (`KpiRow`)
  3. [ ] "Today" panel — deferred (needs quest engine in P2)
  4. [x] Skill focus — top 3 priority skills (`TopSkills`; sparkline deferred to slice 3d)
  5. [x] Recent evidence — last 5 with source + type chip (`RecentEvidence`)
  6. [ ] Repo activity — deferred (needs commit ingest in slice 2b)
  7. Market pulse — deferred to P3
  8. Jobs snapshot — deferred to P4
- [x] Empty states for every widget (real-copy, no lorem)
- [x] Skeleton on load, not spinners
- [x] Real-data-only; no placeholder numbers ever

### Frontend
- [~] 15 Dashboard — LevelHeader + ContributionHeatmap + TopSkills + RecentEvidence + KpiRow shipped; Today panel + Repo activity deferred (need market data + commit ingest)
- [x] 16 Skill tree — `/skills` grouped by cluster with search + filter
- [x] 17 Skill detail — `/skills/[id]` with proficiency/confidence, evidence list, reason log (sparkline deferred to slice 3d)
- [x] 18 Evidence explorer — `/evidence` with kind/signal/since-days filters
- [ ] 19 Repository analysis (slice 2b — needs commit ingest)
- [x] 21 Fact base — `/facts` with per-fact accept/reject/delete
- [x] 51 Settings overview shipped
- [x] 52 AI providers (switch/add/test) — `/settings/providers` lists providers, add/edit form, test-connection button
- [x] 52a **Usage & Costs** shipped
- [x] 53 Embeddings (switch mode, re-embed corpus) — `/settings/embeddings`
- [x] 54 Integrations — reauth + revoke wired to GitHub integration (`/settings/integrations`)
- [x] 62 System & workers — `/settings/workers` with queue depth, failed jobs, retry action

### Settings — Usage & Costs dashboard (screen 52a, see `plan/ai-safety.md` Item 9)

**Backend**
- [x] `GET /me/usage/summary?window=7d|30d|90d|mtd` — totals + deltas vs previous window (`apps/api/src/modules/usage/usage.controller.ts`)
- [x] `GET /me/usage/breakdown?by=provider|model|callKind&window=...` — grouped totals sorted by cost desc (prompt / agent / sensitivity `by` values land when those columns get filled)
- [x] `GET /me/usage/timeseries?window=...&bucket=hour|day`
- [x] `GET /me/usage/calls?limit=100&filter={provider,model,errorOnly,...}` (prompt_id / agent_role / sensitivity / min_cost filters land with breakdown fields above)
- [x] `GET /me/usage/budget`
- [x] `POST /me/usage/budget`
- [x] `POST /me/usage/pause` / `POST /me/usage/resume` — flips `app_config.llm_paused` (`assertCallAllowed()` in `usage.service.ts` enforces)
- [x] Redis 60s cache on aggregation endpoints; keyed by `(userId, window, bucket|by)`; invalidated on new `llm_calls` insert
- [x] Composite indexes on `llm_calls`: `(userId, timestamp desc)`, `(userId, provider, timestamp)`, `(userId, promptId, timestamp)` — Prisma migration `20260924000000_llm_calls_composite_indexes`

**Frontend (screen 52a)**
- [x] Header KPI row: Total cost, Total calls, Input tokens, Output tokens with delta chips (`apps/web/src/components/settings/UsageDashboard.tsx`)
- [x] Budget bar: `spent / limit` for the month, color-coded (green < 60%, amber 60–90%, red > 90%), with reset date
- [x] Kill switch: "Pause all LLM calls" toggle, shows current pause state
- [x] Timeline chart: stacked bars over time; window switcher (7d / 30d / 90d / MTD)
- [x] Breakdown tabs (provider · model · call-kind); prompt/agent/sensitivity tabs land when those columns fill
- [~] Sensitivity breakdown: endpoint returns sensitivity totals via `by=callKind` today; the dedicated tab + badge waits on populated `sensitivity` column
- [x] Recent calls table (last 100): time, provider, model, kind, tokens, cost, latency, status
- [x] Filters above table: provider, model, errors-only (prompt/agent/sensitivity/min-cost land with those columns)
- [x] Empty states — friendly copy when nothing yet
- [x] Loading: skeleton rows, not spinners
- [x] Dark + light theme; keyboard-navigable

**Design bar**
- [x] Linear/Vercel aesthetic; mono digits for cost + token counts; sparse charts, no gradients
- [x] Reuses `packages/ui` primitives (Card, Table, Tabs, Badge, Progress)

**Test**
- [x] Unit: aggregation query correctness in `apps/api/src/modules/usage/usage.service.test.ts`
- [x] Unit: budget-exceeded via `assertCallAllowed` — same file
- [ ] Playwright: seed `llm_calls` → navigate to 52a → dashboard renders correct totals; toggle kill switch → subsequent LLM call returns 503 (lands with the DeepSeek-stub golden-flow work below)

### Retrieval — Qdrant collection design
- [x] Collection strategy: **one collection per content class** — `career_facts`, `code_chunks`, `project_docs` shipped in `packages/embeddings/src/collections.ts`; `job_descriptions` + `market_signals` are P3 scope and stay parked
- [x] Payload schema per point: `{user_id, sensitivity, source_id, source_kind, chunk_idx, timestamp, hash}` (BasePointPayload in collections.ts; carried on every write)
- [x] HNSW index config: `m=16, ef_construct=100, ef_search=64` applied on `ensureCollection` in `packages/embeddings/src/qdrant.ts`
- [x] Every query filters by `user_id` (in-process today) + `sensitivity ≤ maxSensitivity` param; server-side payload filter lands with settings UI
- [~] Chunk strategy: 2048-char sliding, 256-char overlap (character-based; tokeniser-based lands with real bge-small)
- [x] Rehydration: chunks retrieved by embedding sim → source_ids re-fetched from Postgres → returned as `SearchHitDto`

### Embedding pipeline
- [x] BullMQ queue `embedding.generate` shipped; retries 5x exp, `jobId: embed:<collection>:<sourceId>` dedupes in-flight
- [x] Idempotency: deterministic point UUID from `sha256(collection:sourceId:chunkIdx:contentHash)` — same content = same point, upsert is a no-op
- [~] Re-embed on text edit: happens automatically for `resume_fact` (commit clears + re-inserts + re-enqueues); sensitivity relabel + model swap deferred to a slice 6b when we add per-repo sensitivity UI
- [ ] Progress reporting to UI: deferred; today's BullMQ Bull-Board style UI comes with screen 62 (workers)
- [ ] Batching + rate-limit governor (deferred: local deterministic embedder has no external call today)

### Testing (see `plan/testing.md`)

**Unit**
- [x] All 7 update rules from blueprint §5.4 (`packages/shared/src/knowledge-rules.test.ts`)
- [ ] `learning_priority` formula — deferred (formula lives in slice 6 alongside market data)
- [x] `level(proficiency, evidence_count)` — boundary values (`knowledge-rules.test.ts`)
- [x] `gap(current, threshold)` — positive, zero, negative cases (`knowledge-rules.test.ts`)
- [x] Evidence-strength weight application (`knowledge-rules.test.ts`)
- [x] AI-assist 5-dimension score computation via evals stub (`packages/ai/src/evals.test.ts`)
- [x] Dedupe on evidence rows (`packages/shared/src/knowledge-rules.test.ts` — chronological fold rejects duplicate ids)

**Integration (Testcontainers)**
- [ ] GitHub sync worker end-to-end (mock GitHub via MSW, real Postgres)
- [ ] `repo.analyze` worker: fixture repo → tree-sitter → skill evidence rows
- [ ] Field-level PII encryption: write → dump → assert opaque → read → assert plaintext
- [ ] Embedding pipeline: text → embed → Qdrant upsert → search → retrieved
- [ ] Migration forward-safety: seed old DB → run migration → row counts + values intact

**Property-based (`fast-check`)**
- [x] KnowledgeAggregator invariants: `proficiency ∈ [0, 100]`, `confidence ∈ [0, 1]`, `historical_demonstrated` monotonic non-decreasing (`packages/shared/src/knowledge-rules.property.test.ts`)
- [ ] Priority formula: deferred until formula lands in slice 6

**Contract tests**
- [ ] GitHub API adapter against recorded fixtures (repos, contents, commits endpoints)

**LLM eval**
- [ ] `packages/ai/evals/skill-extract/` — 20+ resume+repo examples with expected ESCO skill IDs; assert grounding + non-hallucination + count in reasonable range

**Playwright golden flow**
- [x] Playwright installed; `apps/web/playwright.config.ts` + `pnpm --filter @careeros/web test:e2e`
- [x] `e2e/pre-setup.spec.ts` — root renders + preflight renders, 2 tests pass (no auth, no stub needed)
- [x] `e2e/post-setup.spec.ts` — dashboard/skills/evidence/facts smoke + axe a11y on 9 P1 screens (dashboard, skills, evidence, facts, settings/providers, embeddings, integrations, workers, usage). Tests SKIP unless `E2E_STORAGE_STATE` is provided (docs in `e2e/README.md`).
- [~] `e2e/golden-connect-repo.spec.ts` — connect-repo → skills-on-dashboard flow. Route stubs for DeepSeek chat-completions and GitHub `/user/repos` + `/repos/*/languages` shipped. Skips unless `E2E_STORAGE_STATE + E2E_STUB_MODE=1` are set; full green requires a persisted storage-state from a completed wizard.
- [x] `checkA11y(page)` wired via `@axe-core/playwright` across all P1 screens.

**Visual regression**
- [ ] Baselines for every P1 screen (dark + light)

### Security — Item 5: field-level PII encryption (see `plan/security.md`)
- [x] `packages/secrets`: `encryptField(text, master, purpose)` / `decryptField(...)` with HKDF-derived per-purpose subkey (AES-GCM). Marker `enc:v1:<purpose>:<b64>` bakes purpose into ciphertext so ciphertext-swap across fields is caught.
- [x] Prisma middleware auto-encrypt-on-write / decrypt-on-read for marked columns (PrismaService.onModuleInit)
- [~] Marked tables: `resume_facts.content` shipped; `career_goals`, `evidence` self/document columns land when we start persisting sensitive evidence (one-line each in ENCRYPTED_FIELDS)
- [x] Idempotent write: encrypting an already-marked value is a no-op. Backwards-compatible read: plaintext rows pre-encryption pass through unchanged.
- [ ] `pg_dump` opacity test (defer to integration test infrastructure)
- [ ] Deterministic-encrypted secondary index (defer: no search on encrypted columns today)
- [x] Assert-based check in `field.demo.ts`: 8 scenarios pass — round-trip, idempotency, backwards-compat, purpose-binding, master-binding, IV uniqueness, JSON round-trip, malformed rejection

### AI safety (see `plan/ai-safety.md`)

#### Item 1 — Grounded generation contract
- [x] `packages/ai/grounded.ts` — `generateGrounded<T>({facts, schema, prompt})` wraps facts, resolves via prompt registry, runs post-hoc hallucination check
- [~] Post-generation validator: hallucination heuristic (numbers/dates/currency/proper-nouns not in facts) shipped. Strict `evidence_refs ∈ input IDs` schema check deferred until prompt-per-usage schemas land (slice 6 onward)
- [x] Hallucination-suspect heuristic → written to `llm_hallucination_log` (wired for resume-extract today; hook exposed on `generateGrounded` for all future callers)
- [x] Assert-based check in `grounded.demo.ts`: 7 scenarios pass — fabricated `Initech Systems`, `2018`, `2024` all flagged; faithful stub gets 0 suspects

#### Item 4 — Untrusted content wrapping (README ingest)
- [x] `packages/ai/wrap.ts` — `wrapUntrusted(content, sourceKind)` with delimiter + 16-char SHA-256 hash + sanitiser (HTML-encodes `<` in nested `<untrusted*` fragments so no partial match survives)
- [x] `UNTRUSTED_SYSTEM_CLAUSE` exported for every consumer to inline in system prompts
- [~] Resume-extract migrated to wrap + prompt registry; GitHub README + repo-doc chunks will wrap when slice 2b ingests them
- [x] Assert-based checks in `wrap.demo.ts`: 10 scenarios pass — closing-tag injection, opening-tag injection, empty input, determinism, system clause presence

#### Item 8 — Real sensitivity labels
- [x] `packages/ai/sensitivity.ts` — `public | personal | confidential | employer-confidential` with strict ordering + `defaultSensitivityForSource()` inference
- [x] `SensitivityGateService` — provider ceiling policy in `app_config.llm.sensitivity_policy`, fail-closed defaults (external providers = `personal` max, local providers = `confidential` max)
- [x] `resume.service.parse` and `providers.service.probe` gate before instantiating provider; throws 503 with actionable message
- [x] `GET/POST /me/usage/sensitivity` endpoints for the future settings screen
- [ ] Settings UI to review + change labels per repo (deferred: needs settings screen 52 in a later slice)

#### Item 10 — First evals
- [~] `packages/ai/evals/skill-extract/` scaffold: 3 seed cases (`ts-react-node`, `python-django`, `go-postgres`), name-to-ESCO-id mapping, per-case scoring with 10% optional-bonus, `formatReport` summary. 20+-case target still stands.
- [x] `runEval(suite, runner)` API + offline stub runner; `pnpm ai eval` command wiring lands when we add a small runner binary that boots the prompt registry + a DeepSeek key or offline stub
- [ ] CI gate on prompt change (deferred: no CI yet; lands when the first GitHub Actions workflow appears)
- [x] Assert-based check in `evals.demo.ts`: 4 scenarios pass — perfect stub 3/3, empty stub 0/3, partial stub, formatReport shape

## Exit criteria
All boxes ticked, blueprint §24 bullets covered for "evidence-backed profile", PLAN.md updated.
