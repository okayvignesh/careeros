# Phase 2 — Assessment arena

**Status:** In progress (slice 12 corpus ingestion walking-skeleton: `question_bank` gets `sourceKind` + `sourceUrl` + `sourceAttribution` nullable columns (`20260927000000_question_source_columns` migration; existing LLM-generated rows carry null, backwards-compatible); new `apps/api/src/modules/corpus/` with `CorpusAdapter` interface + one concrete `systemDesignPrimerAdapter` (donnemartin/system-design-primer, CC-BY-4.0, fetches README via GitHub raw URL, parses bullet-line questions ending in `?` with markdown-link stripping — 8 assert scenarios in `.demo.ts` cover extraction/dedupe/prose-skip/length-filter/empty-input); new `keypoints-extractor` prompt wraps question as `readme`-sourced untrusted content and returns 2-6 keyPoints for grader compatibility; `CorpusService.sync(userId, adapterId)` fetches → LLM-extracts keyPoints per Q → upserts with attribution + dedupe via existing `promptHash` unique; questions without keyPoints (no provider configured or extraction failed) are SKIPPED at ingest rather than served ungradeable; `GET /admin/corpus/adapters` + `POST /admin/corpus/sync/:adapter` (session-gated; admin role deferred to auth-module role work); `KnowledgeRunner` renders attribution + source link footer when `sourceKind !== null`; `nextKnowledgeQuestion` + `generateKnowledgeQuestion` now include source columns in the response shape. Walking-skeleton limits: only one adapter (system-design-primer), manual sync only (weekly cron defers), attribution UI only in KnowledgeRunner (other runners follow when a source ships for their kind), sensitivity gate treats external content as `readme` (matches existing GitHub-README handling). Slice 11 boss battles walking-skeleton: new `boss_battles` migration (`20260926000000_boss_battles`) with partial-unique on `(userId, milestone) WHERE status='passed'` (one-pass-per-milestone, retry after fail/expire ok) + partial-unique on `(userId) WHERE status='active'` (no parallel bosses), 30-minute default `durationS` server-authoritative timer; `AssessmentsService.getEligibleBossMilestone` (auto-expires stale actives), `startBossBattle` (picks 3 knowledge Qs from touched skills with variety bias, generates fresh if pool <3), `getBossBattle`, `submitBossBattle` (server-side expiry check FIRST so client clock skew can't cheat, grades all 3 via existing `gradeWithLlmOrFallback`, writes evidence per skill per Q, awards `xpFor('boss-battle', overall)` — 1000 base XP), attempts stored as normal `attempt` rows with `bossBattleId` on `answerJson.sourceRef`; `GET /assessments/boss/eligible`, `POST /boss/start`, `GET /boss/:id`, `POST /boss/:id/submit`; `/arena/boss/[id]` runner with server-authoritative countdown (updates every 1s, thresholds tint the timer amber/red at <5m/<1m), disabled inputs + submit button when timer hits 0, terminal-state view for passed/failed/expired; Arena overview adds boss banner (Swords icon, "Resume boss" if active or "Start boss battle" if milestone eligible). Walking-skeleton limitations: knowledge-only questions (mixed-kind boss defers to a follow-up), fixed 30-min duration, no multi-skill combo requirement, no notifications on unlock. Slice 10 mock-interview walking-skeleton: `GeneratedMockInterviewSchema` (2 technical + 1 behavioral, fixed shape) + `MockInterviewGradeSchema` (per-Q score + overall) in shared; `gradeMockInterview` rule fallback (mean of per-Q `gradeKnowledge`) with 3 assert scenarios; `mock-interview-generator` + `mock-interview-grader` prompts registered; `AssessmentsService.nextMockInterview` + `generateMockInterview` + `gradeMockInterviewAttempt` (reuses `question` with kind='mock-interview', full 3-Q shape in `answerHint` JSON, first Q's keyPoints in `keyPoints[]` for legacy readers); grader delegates to the slice-8 `runLlmGraderOrFallback` helper — 5th assessment type landed in ~250 total LOC vs. ~350+ for slice 5 code-review, confirming the extraction paid off; `GET/POST /assessments/mock-interview/{next,generate,grade}`; `/arena/mock-interview` runner (3 numbered questions with per-Q textareas, technical-vs-behavioral placeholder hints, single submit, Cmd/Ctrl+Enter); Arena overview adds Mock-interview card + fifth remediation CTA. External question corpus scoped as separate future slice (see below). Slice 9 level-unlock UX: AttemptResult now returns `previousLevel` + `leveledUp` (computed server-side via `levelChange(totalXp, xpAwarded)` — no schema change, derived from existing xpEvent history); `/arena/results/[id]` renders a `Sparkles` + "L{prev} → L{new}" banner above the score when `leveledUp` is true, `motion-safe:` prefixed transitions so it collapses cleanly under `prefers-reduced-motion`. Slice 8 refactor: extracted `runLlmGraderOrFallback<T>(userId, {promptId, vars, sensitivity, fallback})` on AssessmentsService — owns the assertCallAllowed → providerConfig → sensitivity gate → decrypt → provider guard → chatStructured → catch-fallback scaffold that was duplicated across all four `grade*WithLlmOrFallback` methods. Each caller now supplies template id/vars/fallback thunk and lands in ~10 LOC (down from ~55). Behaviour unchanged: fallback tag `grader='rule'` still propagates on every failure path; user text still `wrapUntrusted`'d at the caller before hitting the helper; sensitivity per caller (currently `'personal'` for every grader). Adding a fifth assessment type now costs ~30 total LOC instead of ~90. Slice 7 debugging task runner: `GeneratedDebuggingTaskSchema` + `DebuggingGradeSchema` in shared, `gradeDebugging` fallback (attempt-detection + root-cause vocab overlap; honestly labels itself as "LLM grader recommended" in reasoning) with 4 assert scenarios, `debugging-task-generator` + `debugging-task-grader` prompts registered, `AssessmentsService.nextDebuggingTask` + `generateDebuggingTask` + `gradeDebuggingAttempt` (reuses `question` with kind='debugging', brokenCode in `prompt`, rootCause in `keyPoints[0]`, `{language, description, hint}` JSON in `answerHint`), correctness + minimality persisted on `attempt.gradingJson` and `evidence.detail`, surfaced via reused AttemptResult hits (≥0.7) / misses (<0.7), `GET/POST /assessments/debugging/{next,generate,grade}`, `/arena/debugging` runner (broken-code pre-fill textarea with edit-in-place UX + optional hint toggle + Cmd/Ctrl+Enter submit), Arena overview adds Debugging card + fourth remediation CTA. Slice 6 system-design, slice 5 code-review, slice 4 remediation, slice 3 question-generator, slice 2 LLM grader + progression, slice 1 knowledge loop shipped. Sandbox, Monaco, remaining 3 assessment types (build/verbal/mock), boss battles, streamed grader UI defer to slice 8+.)

**Blueprint refs:** §8 (assessment engine), §5.3 (update pipeline), §22 (scoring)
**Screens in scope:** `careeros-screens/phase-2-assessment-arena/` (22, 23, 24, 28, 29, 31)

## Goal
Every attempt updates the right skills with an explainable reason. XP progression works. Quests and boss battles unlock at milestones. Real code executes in isolation; audio is transcribed locally.

## Definition of done
- 8 assessment types functional (knowledge, coding, debugging, build, system design, code review, verbal, mock).
- One completed task changes skill state and logs the reason.
- Repeated failure produces a remediation task.
- XP awarded ≠ proficiency (kept as separate metrics).
- Prerequisite chains prevent locked quests until upstream skills reach threshold.
- Coding runs execute in Docker-per-run sandbox; failing sandbox never crashes the API.
- Verbal defense transcribes via local whisper.cpp; audio never leaves the box.

## Checklist

### Data model
- [~] Migrations: `attempts`, `xp_events`, `streaks`, `question_bank` shipped in `20260924010000_assessment_arena_slice1`; `remediation_tasks` shipped in `20260925000000_remediation_tasks` (with partial-unique `WHERE status='open'`). `assessments`, `assessment_types`, `attempt_answers`, `quests`, `quest_completions`, `level_progress`, `rubrics`, `rubric_versions` defer to their owning slice
- [~] Skill-mapping per assessment: `question_bank.skillIds[]` today (many-to-many weighted table lands with the rubric-driven assessments)
- [~] Rubric definitions: `SYSTEM_DESIGN_RUBRIC` in `packages/shared/src/rubrics.ts` (5 dims × 5 levels + descriptors); `rubric_versions` table lands only when rubrics get in-app editing — for now `rubricHash` (djb2) is persisted on `attempt.gradingJson.rubricVersion` and rebound at grade time
- [~] Anti-farm: 14-day cooldown enforced in-query via `attempts.createdAt` scan; dedicated `question_serve_log` lands with rate limiting

### Code execution sandbox — Docker per run
- [ ] `packages/sandbox` — `runCode({language, code, tests, limits}) → {passed, output, timings, exit_code}`
- [ ] Docker image per language (`careeros/sandbox-node:v1`, `careeros/sandbox-python:v1`, `careeros/sandbox-go:v1`) — distroless, non-root, read-only rootfs
- [ ] Resource limits per run: `--memory=256m --cpus=0.5 --pids-limit=64 --network=none --tmpfs=/tmp:rw,size=64m`
- [ ] Wall-clock timeout: 30s default, per-task override up to 120s
- [ ] Zero network — `--network=none` at the Docker level, verified by test
- [ ] Auto-cleanup: `--rm` + orphan-container reaper cron
- [ ] Result streamed back over WSS to the runner UI (stdout, stderr, timings)
- [ ] Sandbox worker pool: N=2 concurrent runs default, configurable
- [ ] Sandbox metrics: runs/min, avg duration, timeout rate, memory-hit rate
- [ ] Kill switch: `POST /admin/sandbox/pause` for emergency stop
- [ ] Playwright: submit failing code → observe expected fail; submit correct code → observe pass

### Code editor — Monaco
- [ ] Monaco editor via `@monaco-editor/react` in `packages/ui`
- [ ] Language auto-detect from task metadata; fallback picker
- [ ] Theme matches Linear/Vercel design tokens (dark + light variants)
- [ ] Vim/Emacs keybindings toggle in user prefs
- [ ] Auto-save draft every 5s to `attempt_drafts`
- [ ] Test panel below editor showing test results as they stream

### Question bank strategy — LLM-generated with cache
- [x] `question-generator` prompt registered (`packages/ai/src/prompts/question-generator.ts`) with `GeneratedQuestionSchema`; called via `AssessmentsService.generateKnowledgeQuestion(userId, skillId, difficulty)`
- [x] Every generated question stored in `question_bank` with `skillIds[]`, `difficulty`, `promptHash` (unique)
- [x] Reuse before regen: cooldown-filter runs first; generator only triggers when per-skill eligible pool < `MIN_ELIGIBLE_POOL` (2). Duplicate content upserts as a no-op via `promptHash`.
- [x] Cooldown: 14 days default
- [~] Thumbs-down → regenerate + mark original `flagged`: `flagged` column exists and filtered on read; UI toggle lands with the review workflow
- [x] Flagged questions filtered out of every read path (`nextKnowledgeQuestion` where clause)
- [~] Golden eval set (`packages/ai/evals/question-generator/`): 8 skill×difficulty combos with schema+range+difficulty+alias scorer; 15+ target as skills grow

### Assessment engines (8 types)

#### Knowledge-question runner
- [x] Hand-seeded 5 questions + LLM-generated top-ups on demand via `question-generator` (slice 3)
- [x] `knowledge-grader` prompt registered (`packages/ai/src/prompts/knowledge-grader.ts`) with `KnowledgeGradeSchema` shared by both grader paths. Service tries LLM (wrapped as `user-input`, sensitivity=`personal`) and falls back to `gradeKnowledge` on any failure/pause/no-provider; `gradingJson.grader` records the path.
- [ ] Streamed UI feedback — deferred (needs a chatStructured streaming variant on the provider)
- [x] One-attempt-per-question via 14-day cooldown; retries return a new variant from the pool

#### Coding runner
- [ ] Task schema: `{title, description, input_examples, output_examples, hidden_tests, language, starter_code, time_limit_s, memory_limit_mb}`
- [ ] Streamed test results as they run
- [ ] Grading: `passed_tests / total_tests` + complexity heuristic
- [ ] Anti-cheat: check for `import ai_solve` / `# solved by GPT` markers → flag, don't fail

#### Debugging task runner
- [~] LLM-generated broken snippets on demand (walking skeleton — 20+ pre-broken small repos land with the sandbox slice)
- [x] User makes edits in place (broken code pre-fills a textarea, user submits the full replacement)
- [x] Grading: LLM grader returns correctness + minimality (`debugging-task-grader` prompt + `DebuggingGradeSchema`); rule-based fallback (`gradeDebugging`) reports "attempted-a-change" baseline + root-cause vocab overlap

#### Build-task runner
- [ ] Spec: functional requirements + acceptance tests + time budget
- [ ] User builds in editor (multi-file) → tests run via sandbox
- [ ] Grading: test result + code-review agent findings
- [ ] Examples from blueprint §8: Redis-backed rate limiter, URL shortener, etc.

#### System-design rubric grader
- [x] Rubric definition (TS module, not YAML — no parser dep): 5 dimensions (scalability, reliability, cost, tradeoffs, clarity) × 5 levels each with prose descriptors, in `packages/shared/src/rubrics.ts`
- [x] User writes design (markdown-friendly textarea, pre-filled structured template: problem / high-level / deep-dive / trade-offs) via `SystemDesignRunner.tsx`
- [x] `system-design-grader` prompt scores each dimension against descriptors with cited notes; renders rubric inline; overall = mean/5
- [~] Rubric-versioned: `rubricHash` (djb2, 8 hex) persisted on `attempt.gradingJson.rubricVersion` at grade time; dedicated `rubric_versions` table lands when rubrics become in-app editable

#### Code-review task
- [x] LLM produces a diff with N injected defects (`code-review-generator` prompt + `GeneratedCodeReviewSchema`; upserts into `question_bank` with kind='code-review')
- [x] User annotates findings (`/arena/code-review` runner: unified-diff view + one-finding-per-line textarea)
- [x] Grader compares user's findings to known defects: precision + recall (`code-review-grader` prompt + `CodeReviewGradeSchema`; overlap-coefficient rule-based `gradeCodeReview` fallback with 5 assert scenarios)

#### Verbal-defense runner
- [ ] Audio via `MediaRecorder` API (webm/opus) in browser
- [ ] Uploaded to MinIO with sensitivity=`personal`
- [ ] `whisper.cpp` compose service transcribes; `whisper-small` English by default
- [ ] Transcript + question prompt → evaluation agent (`verbal-defense-grader`) scores technical accuracy + communication
- [ ] Audio auto-deleted after 30 days (retention setting)

#### Mock-interview panel
- [~] Multi-turn session: walking-skeleton ships single-turn 3-Q batch via `mock-interview-generator` + `mock-interview-grader` prompts; multi-turn + `interviewer-technical`/`interviewer-behavioral`/`panel-orchestrator` sub-agents defer until we're actually blocked by single-turn quality
- [~] Session state in `mock_sessions` deferred with the multi-turn variant; today the session is the single `attempt` row (kind='mock-interview')
- [x] Session composed: 2 technical + 1 behavioral (fixed shape; expandable to intro → N technical → 1 behavioral → wrap with the multi-turn table)
- [x] End: panel-style summary in `attempt.reasoning`; per-Q scores in `attempt.gradingJson.questions[]` and `evidence.detail.perQuestion`

### Progression

- [x] XP formulas shipped in `packages/shared/src/assessment.ts::xpFor` for all 11 task kinds (knowledge, coding-easy/medium/hard, debugging, build, system-design, code-review, verbal-defense, mock-interview, boss-battle). Score in [0..1] scales linearly.
- [x] Level bands: pure function `xpLevel(totalXp) → {level, xpInLevel, xpToNext, totalXp}` wrapping the shared `xp.ts` curve so dashboard + arena stay in sync
- [ ] Quest generator: deferred (needs market data from P3 for the priority formula)
- [~] Boss-battle scheduler:
  - [x] Trigger at level milestones (10, 25, 50, 75, 100) via `getEligibleBossMilestone` (lowest un-passed milestone the user has reached)
  - [ ] 3+ related-skills threshold trigger (defers — needs prereq graph)
  - [ ] Multi-skill combo requirement (defers — walking-skeleton picks 3 Qs with a variety bias but no strict combo rule)
  - [~] Time-boxed: fixed 30-minute `durationS` today; 2-8 hour configurable defers to per-milestone scope
  - [x] Server-authoritative timer via `boss_battles.startedAt + durationS`, client shows countdown, server rejects late submissions with 400
- [x] Streak tracker: 1-attempt/day threshold, 2 monthly grace days, gap-larger-than-grace resets to 1. Pure `streakTick(state, at)` + `newStreak(now)` in `packages/shared/src/assessment.ts`; `AssessmentsService.tickStreak` persists to `streaks` on every attempt.
- [x] Level-unlock UX: subtle banner + `motion-safe:` fade+slide-in on `/arena/results/[id]` when `leveledUp` is true (server-computed via `levelChange(totalXp, xpAwarded)`; no client-side previous-level tracking needed)

### Update pipeline
- [x] Every attempt writes one `Evidence` row per mapped skill (kind=`assessment`, signal derived from score: >=0.7 → `correct-independent`, else `incorrect-with-correction`; `weightHint` = raw score)
- [x] `KnowledgeAggregator` from P1 consumes via `syncSkillState` in `apps/api/src/common/aggregate-skill.ts` → recomputes `candidate_skill_state` + appends `skill_state_events` reason
- [x] Repeated-failure → remediation task (`shouldRemediate` in shared, `reconcileRemediation` in service, partial-unique open constraint, auto-close on pass ≥0.7)
- [~] Anti-farm: 14-day same-variant cooldown live. Rapid-fire detection + retry-weight discount defer to slice 5

### Frontend
- [x] 22 Arena — `/arena` with level/XP/streak KPIs + open-remediation section (Knowledge / Code review CTAs per open task, Mark done) + recommended-today cards (knowledge + code-review) + recent-XP list + dashed placeholders for coding/design/verbal (`ArenaOverview.tsx`)
- [x] 23 Knowledge runner — `/arena/knowledge`, one question, keyboard-first, Cmd/Ctrl+Enter submit, optional hint toggle (streamed feedback lands with LLM grader)
- [ ] 24 Build/code runner — deferred to slice 2 (Monaco + sandbox)
- [x] 28 Attempt result — `/arena/results/[id]` with score, hits/misses, per-skill level+proficiency delta, XP + total + streak, next-question CTA (`AttemptResult.tsx`)
- [ ] 29 Quest detail — deferred (needs quest generator)
- [x] 31 Progression — `/arena/progression` with level bar + 7d/30d XP timeline + streak/attempts/total-XP KPIs + recent-XP list (`ProgressionPanel.tsx`, `GET /assessments/progression/timeseries`)

### Testing (see `plan/testing.md`)

**Unit**
- [x] XP formula per task type — `packages/shared/src/assessment.test.ts` covers scaling, clamp, per-kind base (13 scenarios total)
- [x] Level function boundaries — same test file: level 1 at zero XP, monotone growth, capped at 100
- [ ] Rubric grader — deferred with system-design slice
- [~] Anti-farm: 14-day cooldown verified by construction (query excludes recent `questionId`s); rapid-fire + retry-discount defer to slice 2
- [x] Streak logic — same test file: first attempt, same-day noop, next-day bump, grace-covered gap, gap-exceeds-grace reset, monthly refill

**Sandbox security (real Docker)**
- [ ] Memory bomb → OOM-killed within limit (per language)
- [ ] Network access → DNS blocked; `fetch()` fails
- [ ] Fork bomb → pids-limit kills
- [ ] Wall-clock timeout → SIGKILL at 30s
- [ ] Filesystem escape → EACCES on `/etc/passwd`
- [ ] Container reaper cleans up orphans

**Integration (Testcontainers)**
- [ ] Complete coding attempt: submit → sandbox → grade → evidence row → aggregator → skill state shifts + reason logged
- [ ] Mock-interview session state persistence across turns
- [ ] Question-bank dedupe: cooldown-window enforcement

**LLM evals**
- [~] `knowledge-grader/` — 6 seed cases across four score bands (perfect/partial/empty/wrong) with band + required-hits + required-misses scoring. Runs offline via stub in `knowledge-grader.demo.ts`; 20+ target as the question bank grows.
- [~] `question-generator/` — 8 seed cases across easy/medium/hard for react, typescript, node, postgres, docker, kubernetes; scores schema-valid + keyPoints-in-range + prompt-length + difficulty-match + skill-alias. 15+ target as more skills land.
- [ ] `rubric-evaluator/` — deferred to slice 4 with system-design rubric

**Playwright golden flows**
- [ ] Full knowledge attempt end-to-end (fixture question → answer → grade → skill delta visible)
- [ ] Coding-task submission with sandbox pass + fail flows
- [ ] `checkA11y(page)` on screens 22, 23, 24, 28, 29, 31

**Visual regression**
- [ ] Baselines for P2 screens

### AI safety — Item 7: agent boundaries (see `plan/ai-safety.md`)
- [ ] `packages/ai/agents/` — `question-generator`, `assessment-grader`, `rubric-evaluator`, `verbal-defense-grader`, `interviewer-technical`, `interviewer-behavioral`, `panel-orchestrator`
- [ ] Each declares role/tools/inputSchema/outputSchema/maxIterations
- [ ] `packages/ai/orchestrator.ts` holds mock-session state in Postgres
- [ ] Tool registry with per-agent allowlist
- [ ] No agent direct DB write — via Nest domain services only
- [ ] `AgentIterationExceeded` on breach
- [ ] Every agent output carries `evidence_refs`, `confidence`, `reasoning_summary`
- [ ] Eval sets: `assessment-grader` (20+ pairs), `rubric-evaluator` (10+ designs with expected scores)

### Observability additions (see `plan/observability.md`)
- [ ] Metrics: `attempts_total{type,result}`, `sandbox_runs_total{language,result}`, `sandbox_run_duration_seconds`, `xp_awarded_total{type}`, `quest_completions_total`
- [ ] Log: every attempt with `attempt_id`, `user_id`, `skill_ids[]`, `score`, `duration_ms`

### External question corpus (walking-skeleton shipped in slice 12; expansions parked below)

Slice 12 shipped one adapter (`system-design-primer`) with manual sync, LLM-driven keyPoints extraction, attribution stored + rendered in `KnowledgeRunner`, dedupe via existing `promptHash`. What's still parked:



Today every question (knowledge, code-review, system-design, debugging, mock-interview) is LLM-generated on demand. Dedup is per-user 14-day cooldown + `promptHash` unique. That's fine for walking-skeleton but a real user needs breadth + variety pulled from vetted sources so LLM output isn't the only signal. Scope of the future slice:

- **Sources (permissive-license only, no ToS violations):**
  - `donnemartin/system-design-primer` (Creative Commons Attribution 4.0)
  - `yangshun/tech-interview-handbook` (MIT)
  - `mtdvio/every-programmer-should-know` (CC0)
  - `poteto/hiring-without-whiteboards` (MIT)
  - Community `awesome-*-interview-questions` repos vetted per-repo for license
  - Explicitly OUT: LeetCode / HackerRank / Glassdoor / leaked-company-docs — same ToS boundary as job scraping (blueprint non-negotiable #4 & AGENTS.md rule 4). No exceptions.
  - Stack Overflow acceptable only with CC-BY-SA attribution stored on the row and shown to the user.
- **Ingestion pipeline** (`packages/question-corpus/`):
  - Adapter per source with declared license + attribution URL + last-synced timestamp.
  - Fetch → parse (markdown / YAML / JSON per adapter) → normalize into `{prompt, kind, skillIds[], difficulty, keyPoints[], sourceRef}`.
  - Dedupe against `question_bank.promptHash` (existing unique) + soft-dedupe via embedding-similarity on prompt (Qdrant search ≥0.9 = flag as near-duplicate, human review before insert).
  - Skill mapping: use `SkillCatalogue.matchByAlias` (already exists via ESCO-lite) to resolve source tags to canonical skill IDs.
- **Refresh cadence:** weekly BullMQ cron per source (respects GitHub 5000/hr limit); manual "sync now" button in Settings for the operator.
- **Sensitivity:** every ingested row = `public` (source is public-license content); user data never contaminated in.
- **Attribution UI:** every served question that came from an external source shows source name + license + link in the runner footer. Meets license terms.
- **Fallback:** LLM generation stays as the on-demand backstop when corpus is empty for a skill or the eligible pool exhausted after cooldown.
- **Quality gate:** every ingested row passes through the existing prompt-registry contract (schema-validate + hallucination-suspect flagging). Corpus rows are not exempt from safety.

Non-goals for this slice: no automated scraping of non-permissive sources, no LinkedIn/Blind/Glassdoor, no leaked company interview docs. If a source's license is unclear, it doesn't ship.

### Cross-slice cleanup (parked)
- [ ] `next{Knowledge,CodeReview,SystemDesign}Task` fallback path: when a skill-filtered eligible pool is empty AND on-demand generation fails, the fallback re-queries with `kind` only. User asked for skill X, may get a task from skill Y. Options: (a) throw NotFoundException with an actionable message, (b) return the off-skill task but tag it in the UI. Same 3-line pattern in each service method; if a 4th assessment type ships with the same shape, extract a shared `pickQuestionForSkill(kind, userId, skillId)` helper at the same time.

## Exit criteria
All boxes ticked, blueprint §8 assessments covered, PLAN.md updated.
