# Phase 3 — Market engine

**Wave C additions (see `plan/HANDOFF.md` for the full ship map):** 4 real ATS/aggregator adapters (Ashby + Greenhouse + Adzuna + Arbeitnow — `71add8f`/`6a527e0`/`a652a89`); adapter contract-test suite + weekly drift workflow (`5d19b79`/`03a5ebb`/`ec4af44`); verify stage + trust-order + cross-source-dedupe + `JobRejectLog` admin re-verify (`78c0c9d` → `9fab7e3`, 87 tests); seniority + role + comp-band classifier + 41-currency FX snapshot (`ef2dc5c`/`523b922`/`fea8848`, 109 tests); weekly `market_snapshot` cron + `TrendDiff` + `/me/market/snapshot/*` (`feb251a`/`4aa8357`/`162be21`/`3c5fcdf`, 68 tests; IMMUTABLE bug fixed at `06b8056`); 3 market/settings screens shipped for wizards (`49e8393`/`d7ecd14`/`1ddd705`); `injection-scan` + `wrapUntrusted` wired on JD + market-brief + resume + dossier (`1a2551e`/`8d7192a`/`8e9b15e`/`55657ed`); `@RequireAdmin()` guard on admin routes + N+1 fix in `JobsService.sync` + match-score pagination (`24f436b`/`519ef56`/`ec4af44`). Ship-blocked: dedicated reject-audit UI (backend + admin endpoints shipped; visual UI belongs to parallel-session web work).

**Status:** In progress (slice 18 weekly market brief walking-skeleton: new `market_briefs` table (userId + generatedAt + window + statsJson + content markdown + sourcesJson) with `(userId, generatedAt DESC)` index; `MarketBriefContentSchema` in shared (sections[] with heading/body/sourceUrls[]); `market-brief-writer` prompt wraps the job-title sample as `job-description` untrusted content, receives stats + candidate context + allowed source-URL list, insists every cite comes from the list; new `apps/api/src/modules/market-brief/` module: `loadFilteredPool` applies user prefs + 45d freshness cutoff, `computeStats` folds top skills (top 10), top companies (top 10), remote share, new-in-window; `generate(userId)` synthesizes prose (temp 0.3), post-filters cited URLs against the sources list (hallucination guard), persists; `getLatest(userId)`; `GET /me/market-brief/latest` + `POST /me/market-brief/generate`; `/brief` page: KPI row + rendered sections + per-section source links (open in new tab) + collapsible raw-stats bar-tables + edit-filters back-link. AppNav gets a Market brief link. Walking-skeleton limits: on-demand only (no cron), no "what changed vs last week" diff, no per-role slant beyond passing the target roles as context, no fact-check-gate prompt (relies on the URL post-filter + the small sample size). Also: slice-17 verifier's "N older than the freshness window" copy fix shipped inline (now reads "N older than 45 days"). Slice 17 freshness gate + honest reject copy: `JobsService.list` gains `FRESHNESS_DAYS=45` hard cutoff (rows older than that get rejected pre-scoring, counted as `stale` in `RejectStats`) + `AGING_DAYS=14` soft flag (`JobListItem.aging=true` for rows in the 14-45 day window); JobsList renders an "Aging" chip in the Posted column and includes stale in the filtered-out explainer line; reject line now says "(from N scanned in the current page)" so users can see the pool scope is not the whole DB — verifier's honesty concern (slice-16 debt) addressed; settings page copy updated to enumerate live filters (remote-only / must-have / dealbreaker / blacklist / freshness) and be honest about which fields are collected-but-not-enforced-yet (target roles / locations / comp / seniority). `companyBlacklist` compare now trims + lowercases both sides. Slice 16 user preferences + relevance filter: new `user_job_preferences` table (one row per user, upsert semantics with sensible empty defaults); `JobPreferencesInputSchema` in shared covering target roles, locations, remote-only, comp band + currency, seniority bands, must-have + dealbreaker skills, company blacklist; new `apps/api/src/modules/job-prefs/` module with `GET/PUT /me/job-preferences`; `JobsService.list` now applies preferences BEFORE match scoring (remote-only, dealbreakers, must-haves, blacklist), counts rejects per reason, returns `{jobs, total, rejected}`; `/settings/job-preferences` page + panel with tag inputs, checkbox toggles, seniority-band chips, comp min/max/currency inputs, save-and-timestamp footer; `/jobs` shows an inline "filtered out by your preferences: N not remote, M missing must-have, ..." line with an "adjust" link + "Edit filters" nav link; new `apiPut` helper in api-client. Slice-15 debt fixed inline: match query now reads from `CandidateSkillState.historicalDemonstrated = true` (the honest monotonic invariant) instead of raw Evidence, so stray self-claims don't inflate scores. Match-cell color tint suppressed for jobs with <3 required skills (percentages snap too much). Pagination pool ceiling parked in the debt list. Slice 15 match score: new `packages/shared/src/match.ts` with `matchScoreForJob(userSkillIds, jobSkillIds) → {score, matched, total, missing}` (returns `null` score when job has no extracted skills — 6 assert scenarios green); `JobsService.list(userId, ...)` loads user's touched skills from `Evidence` (distinct skillId, walking-skeleton takes any evidence as "user has this skill"; weighted-by-proficiency lands later), scores every job in the eligible pool, sorts by score DESC with nulls last then falls back to `sourcePostedAt`; `JobsList` gets a new Match column with color-tinted % chip (accent ≥70%, warning ≥40%, neutral otherwise, dash for null with "extraction pending" tooltip) and a header note explaining the sort. Slice-14 verifier's empty-catalogue short-circuit also shipped: `extractSkillsBatch` bails early with a warning if `Skill.findMany()` returns 0 (no LLM calls burned). Slice 14 job skill extraction: `jobs_normalized` gains `skillIds text[]` + `skillsExtractedAt timestamptz` + GIN index; new `job-skill-extract` prompt constrained to the ESCO-lite catalogue (invalid IDs dropped post-parse); `JobsService.extractSkillsBatch(userId, limit)` picks unextracted jobs and runs one LLM call each (skip-on-failure so batch survives one bad row); `extractSkillsForJob(userId, jobId)` for single-row backfill; `GET /jobs?skill=X` filters via GIN; `POST /admin/jobs/extract-skills?limit=N` + `POST /admin/jobs/:id/extract-skills`; `JobsList` renders clickable skill chips per row (click sets `?skill=` filter, X clears it) + "Extract skills" button next to Sync. Attribution rendering (slice-13 debt item 2) also shipped: per-source attribution block above the table, keyed off `/admin/jobs/adapters`. Slice 13 walking-skeleton: `jobs_raw` (append-only) + `jobs_normalized` (unique on `canonicalUrl`) migrations shipped; new `packages/job-pipeline/` with `RawJobSchema` + `JobSourceAdapter` interface + `remotive` adapter (public JSON, tier-2, no auth); `mapRemotive` unit-tested with 5 assert scenarios; `JobsService.sync(adapterId)` runs the walking-skeleton pipeline (fetch → append raw → upsert normalized by canonicalUrl, tracking `sourceIds[]` for provenance); `GET /jobs?limit=&offset=` list, `POST /admin/jobs/sync/:adapter` manual trigger, `GET /admin/jobs/adapters` list; `/jobs` page + `JobsList.tsx` table (title/company/location/source/posted/open) with in-page "Sync from Remotive" button + empty-state CTA; AppNav gets a Jobs tab. Walking-skeleton limits: no skill extraction, no verification-state transitions (everything lands as `unverified`), no cross-source fuzzy dedupe (URL-only), no freshness gate, no relevance filter, no match score, no reject audit, no per-user preferences, no cron — all follow-up slices per the checklist below.)
**Blueprint refs:** §9 (market intelligence), §10.7 (job source trust)
**Screens in scope:** `careeros-screens/phase-3-market-engine/` (32, 33, 34, 55, 56)

## Goal
System explains current role/stack signals with dates and sources. Job demand kept separate from tech-news signals. Rolling 7/30/90-day windows.

## Definition of done
- Weekly market brief generated with source links and time windows.
- Skill-demand table computed from ingested jobs only (not news).
- Emerging-tech signals computed from news + engineering blogs.
- Trend windows: 7d, 30d, 90d visible on every metric.
- Source trust states (VERIFIED / DISCOVERED / STALE / CLOSED / UNVERIFIED) enforced.

## Checklist

### Data model
- [~] `jobs_raw` + `jobs_normalized` shipped in `20260928000000_jobs_walking_skeleton`. `job_source_records` + `job_verifications` land with adapter #2 (cross-source dedupe needs them). `news_items`, `engineering_posts`, `market_snapshots`, `skill_demand_series`, `tech_signal_series` all defer to the analysis + brief slices.

### Ingestion — ATS (unauthenticated public feeds)
- [ ] Ashby public Job Postings adapter
- [ ] Greenhouse public Job Board adapter

### Ingestion — permissive aggregators (free APIs)
- [ ] Adzuna adapter (free tier, ~10k calls/mo)
- [x] Remotive adapter (public JSON feed) — `packages/job-pipeline/src/adapters/remotive.ts`, tier-2, no auth. `mapRemotive` mapper + 5-scenario assert test.
- [ ] Arbeitnow adapter (public JSON feed)

### Ingestion — paid aggregators (optional, behind settings toggle)
- [ ] JSearch (RapidAPI) adapter — covers LI/Indeed legally via partner
- [ ] Serpapi Google Jobs adapter — alternative to JSearch
- [ ] Settings UI: paid providers off by default, key entry per provider

### Ingestion — signals
- [ ] Engineering-blog RSS ingest (allowlisted feeds)
- [ ] Tech-news search feed (permitted source only — decide)
- [ ] Deduplication (canonical URL, source ID, content fingerprint)
- [ ] Freshness worker — periodic revalidation, mark stale/closed

### Ingestion — browser discovery
- [ ] Deferred to **P3.5** (desktop companion agent). Agent-sourced jobs land here tagged `DISCOVERED`, never `VERIFIED`.

### Ingestion — email alerts (P5 dependency, wire hooks here)
- [ ] Deferred to **P5** (Gmail integration). LinkedIn / Indeed / Naukri alert-email parsers feed the same pipeline below.

### Universal filter pipeline (source-agnostic)

Every incoming job — ATS APIs, free aggregators, paid aggregators, desktop agent, email alerts — passes through the same stages in order. No source bypasses. Reason logged at every reject.

```
raw ingest → normalize → dedupe → freshness → skill extract → verify → relevance → match score → land
```

- [x] `packages/job-pipeline` — package shipped with `RawJobSchema` + `JobSourceAdapter` interface. Adapters produce `RawJob[]`; pipeline stages live in `apps/api/src/modules/jobs/jobs.service.ts` for the walking-skeleton (extracted to package when a second concern needs the logic).
- [x] Stage 1 — **Raw ingest**: `jobs_raw` row per fetch (source, sourceId, canonicalUrl, payload, fetchedAt). Append-only.
- [~] Stage 2 — **Normalize**: minimal canonical schema (title, company, location, remote, description, sourcePostedAt, primarySource, sourceIds[]). Comp band + seniority extraction defers to the analysis slice.
- [~] Stage 3 — **Dedupe** — walking-skeleton dedupes on canonicalUrl only (upsert). content-fingerprint + fuzzy dedupe land with adapter #2 (needs cross-source overlap to be meaningful).
- [x] Stage 5 — **Skill extraction**: `job-skill-extract` prompt constrained to the ESCO-lite catalogue, invalid IDs dropped post-parse. `JobsService.extractSkillsBatch` walks unextracted jobs one at a time (LLM per row, skip-on-failure). `skillsExtractedAt` marks processed rows; `?skill=X` filter via GIN index on `skillIds`. Async worker + auto-run-on-ingest defer to a later slice.
- [x] Stage 4 — **Freshness gate**: `JobsService.list` rejects rows older than `FRESHNESS_DAYS` (45), flags `aging=true` when older than `AGING_DAYS` (14). Uses `sourcePostedAt` when present, falls back to `firstSeenAt`. Per-user configurable threshold defers to when `UserJobPreferences.freshnessDays` gets exposed in the settings form.
- [ ] Stage 5 — **Skill extraction**: LLM structured output, ESCO-normalized skill IDs.
- [ ] Stage 6 — **Verification**: resolve to canonical ATS URL where possible; assign `VERIFIED / DISCOVERED / STALE / CLOSED / UNVERIFIED`. Only `VERIFIED` eligible for auto-apply queue.
- [~] Stage 7 — **Relevance filter** (user rules): shipped in `JobsService.list` for `remoteOnly`, `mustHaveSkills`, `dealbreakerSkills`, `companyBlacklist` (case-insensitive). Rejects counted per reason and returned to the UI. Target-role classification, comp-band comparison (requires normalized comp from analysis slice), seniority-band comparison (requires classifier), min-company-size, visa sponsorship, and location fuzzy match defer.
- [~] Stage 8 — **Match score**: canonical weighted scorer `computeMatch` + list projection `computeMatchResult` in `packages/job-pipeline/src/stages/match.ts`, shared by `JobsService.list` (over-fetch → score → sort → paginate) and `MatcherService.scoreJob` (detail) so list and detail can never disagree. Relevance filter also extracted to `packages/job-pipeline/src/stages/relevance.ts`. Remaining: confidence-adjustment + `learning_priority`; precompute + `user_job_match` when pool exceeds ~2k jobs (ponytail note in code).
- [ ] Stage 9 — **Land**: `jobs_normalized` row with state, relevance_score, match_score, first_seen_at, last_verified_at, primary_source, all_sources[].

### User preferences (drives Stage 7)
- [x] Migration `20260930000000_user_job_preferences` shipped with `targetRoles[], locations[], remoteOnly, compMin, compMax, currency, seniority[], mustHaveSkills[], dealbreakerSkills[], companyBlacklist[]`. `companyWhitelist`, `visaNeeded`, `freshnessDays` defer to when they're actually filtered on.
- [x] `/settings/job-preferences` shipped with tag inputs, seniority chips, comp inputs, save timestamp. "Live estimated jobs/day preview" defers to when nightly cross-pref analytics ship.
- [~] Preferences are read fresh on every list call (no versioning). Re-score is implicit via the on-the-fly compute; explicit `preferences_version` bump lands when a `user_job_match` precompute table exists.

### Reject audit ("why didn't I see this job?")
- [ ] `job_reject_log` — one row per (raw_job, stage, reason, detail)
- [ ] Reason codes: `stale`, `dupe_of:<id>`, `off-role`, `off-location`, `below-comp`, `above-seniority`, `missing-must-have:<skill>`, `has-dealbreaker:<skill>`, `blacklisted-company`, `unverified-and-strict-mode`, `low-match-score:<n>`, etc.
- [ ] Audit-view UI: search a company/role → see every raw fetch and why it was or wasn't shown

### Cross-source merge rules
- [ ] Trust order: `Ashby/Greenhouse (VERIFIED)` > `Aggregator API` > `Agent (DISCOVERED)` > `Email alert`
- [ ] Primary source = highest trust with most recent `source_posted_at`
- [ ] Non-primary sources kept on the row for provenance chip in UI ("Also seen on: LinkedIn, Indeed alert")
- [ ] Conflict on comp/title → prefer VERIFIED, else newest, log conflict

### Adapter contract (`packages/job-pipeline/adapters/`)
- [~] `JobSourceAdapter` interface shipped with `{id, name, tier, licenseHint, attribution, fetch() → RawJob[]}`. `authScheme` + `verify(url)` land with the ATS tier-1 adapters (Ashby/Greenhouse need auth + verification).
- [~] `RawJob` Zod schema shipped: `{sourceId, sourceName, canonicalUrl, title, company, location, remote, description, sourcePostedAt, fetchedAt, payload}`. `comp_raw`, structured `location_raw` etc. land with the analysis slice.
- [x] Adapters isolated from pipeline — adapter returns `RawJob[]`, service owns everything downstream.
- [ ] Every adapter respects `packages/shared/rate-limits.ts` policy for its provider (walking-skeleton has no rate-limit governor yet).
- [~] Fixture-based tests: `mapRemotive.demo.ts` covers the Remotive shape via inline fixture. Per-adapter `__fixtures__/` dir lands with adapter #2.

### Paid provider API key management
- [ ] JSearch / Serpapi keys stored encrypted in `provider_configs` (same table as AI provider keys, kind=`job_source`)
- [ ] Settings UI: enter/rotate/test key per paid provider (screen 56 covers)
- [ ] Usage counted per provider: `provider_usage` table tracking requests + cost estimate
- [ ] **All paid-provider usage flows into Usage & Costs dashboard alongside LLM** (extends screen 52a with a "Data services" tab)
- [ ] Per-provider daily/monthly caps in `app_config` → over budget = pause adapter

### Analysis
- [x] Skill extraction from job descriptions — `job-skill-extract` prompt (`packages/ai/src/prompts/job-skill-extract.ts`) constrained to seeded skill IDs (invalid IDs dropped post-parse). Runs on-demand via admin endpoint; auto-run-on-ingest defers to a worker slice.
- [ ] Seniority classifier: `intern | junior | mid | senior | staff | principal | manager+`
- [ ] Role classifier: role families from ESCO occupation groups
- [ ] Rolling-window aggregators (7d / 30d / 90d) precomputed nightly + on-demand
- [ ] Common-combo detection (association rule mining, min support tunable) — e.g., React+TS+Node+AWS
- [ ] Comp normalization:
  - Raw comp text → `{min, max, currency, period}` via LLM extractor
  - Convert to canonical unit (USD/year) via daily-refreshed FX rate (from `packages/shared/fx.ts`, source: exchangerate.host free API)
  - Retain original for provenance
- [ ] Salary/seniority signals surfaced only when structured data is available; never invented

### Trend definitions
- [ ] "Rising" skill: 30d frequency ≥ 20% higher than 90d-baseline
- [ ] "Declining" skill: 30d frequency ≤ 20% below 90d-baseline
- [ ] "Emerging" skill: appeared < 90 days ago with sustained 7d frequency
- [ ] Thresholds in `packages/market/thresholds.ts`, tunable via config

### Brief generation
- [~] Weekly `MarketBrief` — walking-skeleton `MarketBriefService.generate(userId)` shipped: computes stats, wraps job sample as untrusted, LLM synthesizes with URL post-filter, persists to `market_briefs`. Cron scheduling defers.
- [ ] Scheduler: every Monday 08:00 in user's timezone (see AGENTS.md §Timezone)
- [ ] "What changed" diff against last week
- [x] Per-candidate slant (target-role filter) — pool is preference-filtered before stats compute; candidate context (roles, locations, seniority, must-haves) rendered into the prompt.
- [x] Grounded generation — every cited URL post-filtered against the supplied sources list; hallucinated links dropped before persist.
- [~] Fact-check gate before publish — walking-skeleton relies on URL-set post-filter + small sample size; dedicated `injection-scan.prompt.ts`-style classifier defers.

### Frontend
- [~] 32 Market brief — `/brief` page shipped with KPI row + sections + per-section source links + collapsible raw-stats. "What changed" diff + weekly cadence UI defer.
- [ ] 33 Skill demand (top skills, windows, target-role filter)
- [ ] 34 Technology signals (rising/declining, news evidence panel)
- [~] 55 Job sources — walking-skeleton `/jobs` page shipped with adapter-sync button + list table. Dedicated "adapter health + throttle" screen lands with adapter #2.
- [ ] 56 Search providers (config news/search backend)

### Testing (see `plan/testing.md`)

**Unit**
- [ ] Normalization per adapter (raw → canonical)
- [ ] Comp normalization + FX conversion across currencies
- [ ] Trend threshold detection with synthetic time series
- [ ] Freshness gate — >45d rejected, 14–45d marked `aging`
- [ ] Relevance filter — every user-pref dimension
- [x] Match-score formula (isolated from skill graph) — weighted `computeMatch` in `packages/job-pipeline/src/stages/match.ts` (one scorer for list + detail), with `relevance()` in the same package.

**Property-based (`fast-check`)**
- [ ] Pipeline dedupe: for any (canonical_url, source_id) collision set, exactly one primary in output
- [ ] Trust-order merge: for any source combination, primary is highest-trust with newest posted_at

**Fuzz**
- [ ] `injection-scan`: random prompts → returns a score, never throws

**Integration (Testcontainers)**
- [ ] Ashby fixture → normalize → dedupe → verify → land in jobs_normalized
- [ ] Multi-source dedupe: same job in Ashby + Adzuna + agent + email merges to one row
- [ ] Egress allowlist: worker attempting non-allowlisted domain fails at network level

**Contract tests (per adapter)**
- [ ] Ashby, Greenhouse, Adzuna, Remotive, Arbeitnow, JSearch, Serpapi
- [ ] Each: recorded fixture → adapter → output shape validates against `RawJob`
- [ ] Weekly cron re-records; PR opened on drift

**LLM evals**
- [ ] `job-skill-extract/` — 20+ job descriptions with expected ESCO skill sets
- [ ] `job-seniority-classify/` — 15+ examples across bands
- [ ] `market-brief-writer/` — property-based: every claim has source URL

**Playwright golden flow**
- [ ] View weekly brief with real source links
- [ ] `checkA11y(page)` on 32, 33, 34, 55, 56

**Visual regression**
- [ ] Baselines for P3 screens (charts included via stable data seed)

### Observability additions (see `plan/observability.md`)
- [ ] Metrics: `jobs_ingested_total{source}`, `jobs_rejected_total{stage,reason}`, `jobs_verified_total{source,state}`, `adapter_calls_total{adapter,result}`, `adapter_rate_limit_hits_total{adapter}`
- [ ] Log: adapter fetch cycles with `since`, `count`, `duration_ms`, errors per source

### Security — Item 6: egress allowlist enforcement (see `plan/security.md`)
- [ ] Worker container Docker network policy: outbound only to configured provider domains (DeepSeek, GitHub, Ashby, Greenhouse, Adzuna, Remotive, Arbeitnow, JSearch, Serpapi, MinIO, Postgres, Redis, Qdrant)
- [ ] Allowlist rebuilt on config change
- [ ] `docs/egress.md` updated with every path + purpose
- [ ] Test: worker attempting `curl` to non-allowlisted domain fails

### AI safety — Items 4, 5, 7 (see `plan/ai-safety.md`)

#### Item 4 — Untrusted wrapping (jobs + blogs)
- [ ] Every job description and engineering-blog chunk passes through `wrapUntrusted` before any prompt
- [ ] Content-length hash re-verified after model response
- [ ] Test: injection payload in job description → skill extraction ignores it

#### Item 5 — Injection-detection pass
- [ ] `packages/ai/injection-scan.ts` — regex + heuristic scan (IGNORE, SYSTEM:, `<|`, base64, role-swap phrases, unusual unicode)
- [ ] Borderline content → `injection-scan.prompt.ts` cheap classifier (deepseek-flash)
- [ ] Score above threshold → mark `SUSPECTED_INJECTION`; high-risk paths (auto-apply, resume gen) block outright
- [ ] Every flag written to `llm_injection_log` with source, snippet, score, action
- [ ] Audit UI: view flagged items
- [ ] Test: public injection corpus → ≥90% detection at threshold

#### Item 7 — Extraction agents
- [ ] Agents: `job-skill-extractor`, `job-seniority-classifier`, `market-brief-writer`
- [ ] All declared per Item 7 contract; no direct DB write; structured output; iteration cap

### Cross-slice debt (parked from verifier reviews)
- [ ] **Admin routes not actually admin-gated.** `POST /admin/jobs/sync/:adapter`, `GET /admin/jobs/adapters`, `POST /admin/corpus/sync/:adapter` all use `session.requireUserId(req)` — any signed-in user can trigger them. Benign in single-user default; add a `requireAdmin` guard when the auth-module role work lands (P6 hardening area). Until then, don't expose the API publicly.
- [ ] **N+1 in `JobsService.sync`.** Per-raw sequential `create` + `findUnique` + `update`/`create` = 3 round-trips per job × ~1000 Remotive rows. Fine for walking-skeleton (only Remotive ships today). Upgrade to `createMany` for jobs_raw + one `findMany` map + batched upserts when adapter #2 lands or when a single Remotive sync starts exceeding a few seconds.
- [ ] **Match-score pagination pool ceiling.** `JobsService.list` over-fetches `(limit+offset) × 2` rows and sorts by score in-process. At high offsets the ranked pool is only a slice of the DB, so "top by match" on page 5 is really "top of the 500 most-recent." `total` returns the DB count, so the pager can show more pages than the pool can honestly rank. Land alongside a `user_job_match` precompute table when either (a) job pool exceeds ~2k or (b) users start hitting deep pages regularly.

## Exit criteria
All boxes ticked, blueprint §24 bullets on market brief covered, PLAN.md updated.
