# Session Coordination

Live file for parallel Claude Code sessions to see who owns what. Update **before** you start a stream and **after** you ship it. Keep entries short; detail belongs in commit messages and the phase/completion files.

**Last touched:** 2026-10-01 by **session-ponytail**

---

## Active sessions

| Session | Role | Started |
|---|---|---|
| session-ponytail | Group 1 implementer (sandbox wire + form-fill + ATS submit polish + data portability polish) | 2026-10-01 |
| session-ai-infra | Group 2 implementer (circuit breaker + token cap + drift alert + evidence_refs schema) | 2026-10-01 |
| session-design-revamp | Web UI revamp (per memory rule) | ongoing |

---

## Ownership map (right now)

| Path | Owner | Reason |
|---|---|---|
| `apps/web/**` | session-design-revamp | Web UI revamp (memory rule) |
| `packages/ui/**` | session-design-revamp | UI primitives + tokens (in working tree) |
| `infra/docker/Dockerfile.web` | session-design-revamp | Web container tweaks |
| `prisma/schema.prisma` | session-ai-infra | Reserved; do not touch until released |
| `packages/ai/**` | session-ai-infra | Streams #11 circuit-breaker + #12 token cap + #14 evidence_refs + injection evals + probe + more |
| `.github/workflows/nightly-evals.yml` | session-ai-infra | Stream #13 drift alert |
| `scripts/eval-drift.mjs` | session-ai-infra | Stream #13 (shipped file) |
| `docs/observability.md` + `docs/security.md` | session-ai-infra | Shipped in their uncommitted tree; do not touch |
| `apps/api/src/modules/interview-prep/**` | session-ai-infra | Agent files in working tree |
| `apps/api/src/modules/outreach/**` | session-ai-infra | Agent files in working tree |
| `apps/worker/src/github-sync.ts` + `skills-seed.ts` | session-ai-infra | Modified in working tree |
| `apps/api/src/modules/slack/**` | in-flight (unassigned) | Slack module changes present in working tree |
| `apps/api/src/modules/assessments/**` | session-ponytail | C-P2.4 shipped; boss-battle polish next |
| `packages/sandbox/**` | session-ponytail | C-P2.4 shipped |
| `packages/browser-agent/**` + `scripts/browser-agent/**` | session-ponytail | F.3 shipped |
| `apps/api/src/modules/ats-submit/**` | session-ponytail | F.2 shipped |
| `apps/api/src/modules/approvals/**` (hook only) | session-ponytail | F.2 wire shipped |
| `apps/api/src/modules/me/**` | session-ponytail | F.8 shipped |
| `apps/api/src/common/storage.service.ts` | session-ponytail | F.8 shipped |
| `apps/api/src/modules/{jobs,market-brief}/**` | session-ponytail (next batch) | Stream A: N+1 + what-changed + weekly cron |
| `apps/worker/src/market-brief*` | session-ponytail (next batch) | Stream A |
| `packages/testing/**` | session-ponytail | F.8 integration + F.2 msw fixtures + Stream C migration-safety scaffold |
| `packages/email-parsers/**` | session-ponytail (next batch) | Stream C fuzz |
| `scripts/__tests__/**` + `scripts/smoke/**` | session-ponytail (next batch) | Stream C backup byte-inspection + encryption-key exclusion |
| `infra/docker/Dockerfile.api` | session-ponytail (next batch) | Stream D distroless + non-root + cap-drop |
| `docs/backup.md` | session-ponytail (next batch) | Stream D RPO/RTO paragraph |

Everything not listed is unclaimed.

---

## In-flight streams

### session-ponytail

| Stream | Status | Notes |
|---|---|---|
| C-P2.4 sandbox consumer wire | shipped 71e7d8a | 44/44 tests; prompt relocated to apps/api/src/modules/assessments/prompts/ |
| F.3 agent form-fill | shipped 9d0f60c | 71/71 tests |
| F.2 follow-ups (multipart + msw + approval wire) | shipped 492f1ff | 51/51 tests |
| F.8 follow-ups (MinIO + age + round-trip) | shipped e71b28c | 18 unit + 1 integration (skipped locally) |
| A. P3 market debt (weekly cron + what-changed diff; N+1 was already shipped at 24f436b) | shipped 24999e6 | 65/67 (2 pre-existing failures from cbacad2 unchanged) |
| B. Boss-battle 3+ related-skills + multi-skill combo | shipped e743c20 | 19/19 |
| C. Test backfill (backup byte-inspection + enc-key exclusion + email fuzz + migration safety) | shipped 88dfc9c | 76/76 |
| D. Container hardening (non-root + cap-drop + read-only; distroless deferred) + backup RPO/RTO docs | shipped cc914a5 | docker compose config EXIT 0 both modes |
| Grader agents (debugging + mock-interview + system-design) | shipped 522932d | 6/6 new, 57/57 assessments module; prompts local per C-P2.4 pattern |

### session-ai-infra

| Stream | Status | Notes |
|---|---|---|
| #11 circuit breaker on LLM provider (>20% error / 5 min) | claimed | packages/ai/src/providers/** + wrap.ts |
| #12 per-call token cap pre-flight (js-tiktoken) | claimed | packages/ai/** |
| #13 nightly eval drift alert | claimed | .github/workflows/nightly-evals.yml + scripts/eval-drift.ts |
| #14 evidence_refs hard Zod constraint | claimed | packages/ai/src/prompts/** |

---

## Shipped this cross-session batch

- **Remaining assessment grader agents (debugging + mock-interview + system-design)** (session-ponytail, 2026-10-01, not yet committed): resolves the remaining-graders block under `plan/DEFERRED.md` ai-safety.md "Agent boundaries". All three quest kinds exist today (confirmed in `assessments.service.ts`: `kind: 'debugging' | 'mock-interview' | 'system-design'`); nothing was blocked on C-P2.5.
  - **Local prompts** (new, prompts live in-module per the C-P2.4 remediation):
    - `apps/api/src/modules/assessments/prompts/debugging-grader.ts` — `renderDebuggingGraderPrompt(vars)` → `{system, user, schema}`; mirrors packages/ai catalog `debugging-task-grader` verbatim.
    - `apps/api/src/modules/assessments/prompts/mock-interview-grader.ts` — same shape, mirrors catalog `mock-interview-grader`.
    - `apps/api/src/modules/assessments/prompts/system-design-grader.ts` — same shape, mirrors catalog `system-design-grader`; the caller renders `SYSTEM_DESIGN_RUBRIC` dimensions into `{{rubric}}`.
    - `UNTRUSTED_SYSTEM_CLAUSE` imported from `@careeros/ai`; schema binds re-use `DebuggingGradeSchema` / `MockInterviewGradeSchema` / `RubricGradeSchema` from `@careeros/shared`.
  - **Grader agent classes + AgentDef registrations** (new):
    - `apps/api/src/modules/assessments/agents/debugging-grader.agent.ts` — `DebuggingGraderAgent` class with `async grade(provider: AIProvider, inputs): Promise<DebuggingGrade>`; InputSchema (`.parse` guards bad input before the LLM call); calls `provider.chatStructured({messages, schema, temperature: 0})`. Also exports `AgentDef<DebuggingGraderInput, DebuggingGrade>` + `registerDebuggingGraderAgent(registry)` so the shared `agentRegistry` lists it alongside knowledge + code-review graders. `ponytail:` comment: rubric criteria hardcoded in `DebuggingGradeSchema`; move to per-Question grading-rubric column when a different debugging question wants different criteria.
    - `apps/api/src/modules/assessments/agents/mock-interview-grader.agent.ts` — same shape, 3-question (`.length(3)`) contract pinned in the shared schema. `ponytail:` comment names the multi-turn upgrade path.
    - `apps/api/src/modules/assessments/agents/system-design-grader.agent.ts` — same shape, rubric passed in as a pre-rendered string so the agent stays rubric-agnostic. `ponytail:` comment names the per-question-rubric upgrade.
  - **Service wiring** in `apps/api/src/modules/assessments/assessments.service.ts`:
    - Added `AIProvider` type import from `@careeros/ai`.
    - 3 new protected field seams: `debuggingGrader`, `mockInterviewGrader`, `systemDesignGrader` (same `field, not constructor arg` pattern as the existing `runSandbox` seam so no test file needs a widened constructor signature). Each defaults to a `new <Kind>GraderAgent()`.
    - New private method `runGraderAgentOrFallback<T>(userId, {label, sensitivity, callLlm, fallback})` — agent-based sibling of the existing `runLlmGraderOrFallback`. Same gate chain (usage + provider config + sensitivity + decrypt + non-deepseek bail + per-user concurrency ceiling + rule-based fallback) but the LLM call step is a caller-supplied `callLlm(provider)` closure instead of a prompt-registry id. Knowledge + code-review stay on the old method (out of scope per task rules).
    - 3 existing `grade<Kind>WithLlmOrFallback` methods swapped to call `runGraderAgentOrFallback(... callLlm: (p) => this.<kind>Grader.grade(p, inputs))`. All surrounding grading (attempt row shape, evidence writes, XP, streak, hits/misses summarisation, dimension clamp for system-design) left exactly as-is per the "do NOT rewrite surrounding grading" rule.
  - **Module wiring** in `apps/api/src/modules/assessments/assessments.module.ts`: three new `register<Kind>GraderAgent(agentRegistry)` calls in `onModuleInit`, mirroring the shipped knowledge + code-review registrations. Idempotent because `AgentRegistry.register` short-circuits on identical shape.
  - **Tests** (new, one per grader class, assert-based with a stubbed `AIProvider`):
    - `apps/api/src/modules/assessments/agents/debugging-grader.agent.test.ts` (2 cases)
    - `apps/api/src/modules/assessments/agents/mock-interview-grader.agent.test.ts` (2 cases)
    - `apps/api/src/modules/assessments/agents/system-design-grader.agent.test.ts` (2 cases)
    - Each file: (a) one happy-path test proves the grader renders the real prompt, calls `provider.chatStructured`, and returns the Zod-valid Grade shape; the fake provider echoes `schema.parse(response)` so the fake cannot drift from the real contract. The test asserts the question + attempt text actually appear in the user message (proof the grader is grading real inputs). (b) one input-rejection test proves the InputSchema is enforced BEFORE the LLM call — `chatStructured` is not called when `fix` / `questions` / `scenario` is empty.
    - 6/6 new tests pass; 57/57 across the whole assessments module (no pre-existing test broken by the service rewiring).
  - **Nothing shipped was blocked.** All three quest kinds exist in the Question table with `kind` enum values today; no schema change required; `prisma/schema.prisma` untouched.
  - **Test command for monitor**: `pnpm vitest run apps/api/src/modules/assessments/`.
  - **Scope respected**: no changes to `packages/ai/**` (packages/ai prompts for these three graders remain registered in the shared catalog — out of scope), no `prisma/schema.prisma`, no `apps/web/**`, no `apps/api/src/modules/{interview-prep,outreach,slack}/**`, no `apps/worker/**`. `packages/ai/src/prompts/index.ts` unchanged; the three new prompts live local to the assessments module per the C-P2.4 remediation pattern.
  - **No em dashes** in any user-facing string added (BadRequestException messages + schema validation messages inherit from Zod defaults, unchanged).

- **Stream B: Boss-battle 3+ related-skills threshold + multi-skill combo** (session-ponytail, 2026-10-01, not yet committed): resolves `plan/DEFERRED.md` P2 "Boss-battle 3+ related-skills threshold + multi-skill combo requirement".
  - `apps/api/src/modules/assessments/assessments.service.ts`:
    - `startBossBattle` now resolves the user's touched skills to their ESCO `category` (populated by `apps/api/src/seed/esco.ts`, e.g. `frontend`, `backend`, `cloud`) and refuses to start unless at least one category has 3+ touched skills. Error message: "Boss battle needs 3+ related skills touched. Earn evidence on more skills in a shared area (frontend, backend, cloud, ...) first." The threshold is real: the service runs `Skill.findMany({where:{id:{in:touchedIds}},select:{id,category}})` and groups by category before checking size.
    - New `getLargestRelatedTouchedSet(userId)` private helper returns the largest category-group with >= 3 touched skills (short-circuits when touched < 3). ponytail-tagged: in-process group-by; move to SQL once touched-skill / taxonomy pools grow past a few thousand.
    - `pickBossQuestions(userId, restrictToSkills?)` now accepts a related-skill restriction; boss-battle always passes the related set so questions whose only skillId is outside the cluster are excluded even when the user has evidence for them.
    - New `detectBossCombo(questionIds, perQuestionScores)` private helper: deterministic parse off per-question scores + `Question.skillIds` + `Skill.category`. "Combo" = 2+ distinct related skills demonstrated on passing questions (score >= 0.7). Multiplier 1.25x on XP, applied only on a passing boss. Returns `{comboCategory, relatedSkillsDemonstrated, combo, comboMultiplier}`. ponytail-tagged: heuristic parse now; LLM grader prompt expansion is the upgrade path when build-task/debugging boss variants land.
    - `submitBossBattle` now: calls `detectBossCombo` after per-Q grading; computes `xpAwarded = round(xpBase * multiplier)` when passed (base-only on fail); writes `xpEvent.reason = 'attempt:boss-battle:L{m}:combo'` on a passing combo (unchanged `':Lx'` suffix on pass-without-combo or on fail); appends a reasoning line (" Combo detected: N frontend skills, 25% XP bonus." / " Combo detected but boss failed (bonus applies only to passes)."); return shape widened with `comboDetected`, `comboMultiplier`, `comboCategory`, `relatedSkillsDemonstrated` so the controller/UI can render the combo badge without re-parsing the reasoning string.
  - `apps/api/src/modules/assessments/assessments.service.boss-battle.test.ts`:
    - `fakePrisma` extended with `skillCategories` map + `skill.findMany` (preserves prior `skill.findUnique` shape so timer tests stay green).
    - 4 new tests under `B-stream: 3+ related skills threshold`: refuse <3 related, refuse "2+1 split" (<3 in any one category), accept 3+ in one category, restricted pool never surfaces a sibling-category question.
    - 3 new tests under `B-stream: multi-skill combo detection + XP bonus`: full combo (3/3 pass → 1.25x applied, reason suffix `:combo`), no combo (1/3 pass → multiplier 1, no suffix), partial combo on a failed boss (2/3 pass → `combo detected but boss failed`, bonus not applied, suffix absent).
    - Existing concurrent-start test fixture updated to a 3-frontend-skill set so it clears the new threshold.
  - No schema change needed. `Skill.category` + `Question.skillIds` + `Evidence.skillId` are all already seeded; the "related skills" signal lives in the ESCO category column populated by `apps/api/src/seed/esco.ts`.
  - No em dashes in any user-facing string added (BadRequestException messages + comboLine strings).
  - Monitor runs after all 4 streams per the stream rules; no self-verify from this session.

- **Stream A: P3 market-engine parked debt** (session-ponytail, 2026-10-01, not yet committed): closes 3 items from `plan/DEFERRED.md` "P3 (market engine)" + "N+1" block.
  - **N+1 fix in `JobsService.sync`**: verified already shipped at `24f436b` with regression test `apps/api/src/modules/jobs/jobs.service.test.ts` ("constant queries (3), not 100+"). 4/4 N+1-scoped tests green. No new code required; the ponytail ladder says reuse, not re-ship.
  - **Weekly cron for market brief**: new `apps/api/src/modules/market-brief/market-brief.scheduler.ts` — BullMQ repeatable job (`market-brief-weekly`, cron `0 9 * * 1`, static jobId for idempotent restarts). Fires in-process on the API (not the worker) because `MarketBriefService.generate` needs the API-side provider stack (encrypted-secret decrypt + sensitivity gate + per-user LLM concurrency). Mirrors `DailyBriefScheduler` pattern + `market-snapshot.worker.ts` cron shape. Runs 3h after the 06:00 snapshot cron so the fresh snapshot row is in-DB when the brief computes its diff. Enumerates every `UserJobPreferences` row and calls `briefs.generate(userId)`; per-user error is isolated (bad brief does not sink the batch). `MARKET_BRIEF_CRON_DISABLE=1` env opt-out for test/dev.
  - **"What changed vs last week" diff inlined into brief payload**: `BriefDto` gains `diff: TrendDiff` field; both `MarketBriefService.generate()` and `MarketBriefService.getLatest()` call `SnapshotService.diffAgainstLastWeek(userId)` (the diff logic shipped at `feb251a` as a dedicated endpoint — now also returned on the brief DTO so the brief page renders deltas without a second round-trip). `TrendDiff` carries postings delta, remoteShareDelta, topSkillsAdded/Removed/RankChange, newCompanies against the prior 7-14d snapshot of the same `filterHash`. `hasComparison=false` when no comparable prior exists (first-week + prefs-changed-mid-week cases both covered by existing SnapshotService tests).
  - Files touched: `apps/api/src/modules/market-brief/{market-brief.service.ts,market-brief.module.ts,market-brief.scheduler.ts,market-brief.scheduler.test.ts,market-brief.service.test.ts}`. Not touched: `prisma/schema.prisma` (`market_snapshot` from C-P3.4 already covers the diff), `apps/worker/**` (brief needs API-side provider stack), anything in session-design-revamp or session-ai-infra scope.
  - Tests: 5 new scheduler tests (per-user enumerate, batch-survives-one-fail, empty-list, unknown-job-name, cron-pattern-pin) + 2 new diff-inlined tests (generate carries diff, getLatest carries `hasComparison=false`). All 7 pass. 65/67 service tests green overall; 2 pre-existing failures (`newCount: 5 vs 3`) are a date-sensitive fixture bug (pool fixture hardcodes `now=2026-09-27` but `Date.now()` is 2026-10-01) that predates this stream and is orthogonal to the diff/cron work. Scope rule says I don't fix unrelated bugs in files I didn't need to touch for the task.
  - Typecheck: scheduler + diff additions clean. One pre-existing TS error at `market-brief.service.test.ts:131` (`exactOptionalPropertyTypes` on `resourceId: string | undefined`) is unrelated — same code shipped at `d24f62e`.

- **Stream D: container hardening + backup RPO/RTO docs** (session-ponytail, 2026-10-01, not yet committed): closes `plan/DEFERRED.md` security item 10 (partial) + item 8 (RPO/RTO documentation line).
  - `infra/docker/Dockerfile.api`: dropped to non-root UID 1001 (`careeros` user, matches bitnami convention). All `COPY` steps now `--chown=careeros:careeros`; `WORKDIR /app` chown-reset; `USER careeros` set before install. Base stays `node:20-alpine` (distroless breaks `pnpm dev` under the override; ponytail: comment names the upgrade path to a separate prod-only distroless runtime stage).
  - `infra/docker/docker-compose.yml` (api service only; other services untouched): added `read_only: true`, `tmpfs: [/tmp:64m, /app/.cache:64m]`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`. Seccomp uses docker default (ponytail: custom profile at `infra/docker/seccomp/api.json` deferred until a real syscall needs blocking the default allows).
  - `infra/docker/docker-compose.override.yml`: dev override flips `read_only: false` + `user: root` for the api service so `pnpm dev` can still write `.turbo`/nest build caches and the host-owned bind-mounts remain readable. Everyone else in override untouched.
  - `docs/backup.md`: expanded the "RPO and RTO" section with explicit 24h RPO / 2h RTO budgets, pointer to the daily cron slot, 7d/4w/12m retention tier logic, automated weekly restore-test.yml drill, quarterly manual drill cadence, and the `ENCRYPTION_KEY`-not-in-backup budget caveat. All numbers checked against C-P0.8 shipped backup cadence; nothing invented.
  - Parse-check: `docker compose config` (merged with override) → EXIT 0; `docker compose -f docker-compose.yml config` (prod-style, no override) → EXIT 0 with `read_only: true` + `cap_drop: [ALL]` + `security_opt` all present on the api service. No rebuild performed.
  - OFF-LIMITS respected: no changes to worker/web Dockerfiles, no prisma, no packages/ai, no `docs/observability.md` or `docs/security.md`, no `plan/_audit_*`, no git ops.
  - No em dashes introduced (the one pre-existing em dash in override.yml line 2 was not written by this session).

- **F.8 follow-ups** (session-ponytail, 2026-10-01, not yet committed):
  - `POST /me/export` now serializes JSON → `age -r $AGE_RECIPIENT` → MinIO upload at `exports/<userId>/<stamp>_export.json.age` → returns short-lived presigned GET + plaintext manifest.
  - `StorageService` extended with `putExport()` + `presignExportDownload()` + `parseExportKey()` (same per-user key gate as resumes).
  - `age` added to `infra/docker/Dockerfile.api` (apk community package).
  - `apps/api/src/modules/me/me.storage.integration.test.ts`: testcontainers round-trip (seed resumeFact + careerGoal + xpEvent → export → fetch presigned URL → assert `age-encryption.org/v1` header → `age -d` → re-hash + verify manifest sha256 → delete → assertDeletedForUser parity). Skips cleanly without `TESTCONTAINERS_E2E=1` + docker + `age` on PATH.
  - 18 unit tests + 1 integration (skipped locally) pass; `me/` + `storage.service` typecheck clean.

- **F.3 agent form-fill** (session-ponytail, 2026-10-01, not yet committed): allowlist YAML + per-site scripts + selector-health cron, per phase-6:35-43.
  - `packages/browser-agent/src/allowlist/loader.ts`: `AllowlistEntry` schema extended with optional `field_selectors` + `submit_selector` + `success_signal` + `pacing_overrides` (backward compat; existing yamls still validate).
  - `packages/browser-agent/allowlist/{ashby,greenhouse}.yaml`: real field selectors (ashby uses `_systemfield_*`; greenhouse uses `job_application[...]` + id alts for probe compatibility). `linkedin.yaml` + `indeed.yaml` + `naukri.yaml` get placeholder submit + success blocks with `ponytail:` stub comments. New `generic.yaml` wildcard entry with semantic-name heuristics for the generic-apply fallback.
  - `packages/browser-agent/src/scripts/form-fill.ts`: shared `runFormFill(page, entry, payload, mode, opts)` engine. Pure logic, narrowed `FormFillPage` interface (fill/setInputFiles/click/waitForSelector/screenshot) so unit test uses a fake. Dry-run default (no click/success), live mode clicks submit + waits for success_signal. Fail paths: all fields miss -> selector-broken + screenshot; submit missing -> selector-broken; success never arrives -> error.
  - `packages/browser-agent/src/scripts/{ashby,greenhouse,generic}-apply.ts`: real end-to-end scripts delegating to the engine with a domain guard. `linkedin-easy-apply.ts` + `indeed-easy-apply.ts` + `naukri-apply.ts`: stubs returning selector-broken, each with a `ponytail:` comment naming the upgrade path (capture modal/iframe/region fixtures, then fill field_selectors).
  - `packages/browser-agent/src/scripts/dispatch.ts`: `pickFormFillScript(kind)` maps `AgentTaskKind` -> script fn for the agent task-runner.
  - `packages/browser-agent/src/scripts/probe.ts`: `collectProbeSelectors(entry)` + `probeEntry(entry, html)` reusing D.5 `checkSelectorHealth`. Splits comma-grouped selectors as alts (healthy if any alt matches, mirroring Playwright's native OR).
  - `packages/browser-agent/src/selector-health.ts`: bracket matcher upgraded to accept quoted attr values containing `[`/`]` so greenhouse's `[name="job_application[resume]"]` parses.
  - `apps/worker/src/selector-health.worker.ts`: `runSelectorHealth(entries, probe, repo)` + `markSelectorStale(repo, outcome, actor, ctx?)` + `handleSelectorHealth(...)` for the cron handler. Weekly cron (`0 5 * * 1`). `markSelectorStale` emits `audit_log` row (`action='form_fill.selector_stale'`, resource_type=`allowlist_domain`, resource_id=domain, payload includes missing + drifted) and tags `Application.notes` with `[selector-stale:<domain>]` for the live-path failure hook when an `applicationId` is supplied.
  - `apps/worker/src/main.ts`: wires the selector-health queue + worker, probe lambda loads per-domain HTML fixtures.
  - `apps/worker/package.json`: `+@careeros/browser-agent: workspace:*`.
  - `scripts/browser-agent/probe-form-fill-selectors.ts`: CLI operator entry (fixture default + `LIVE=1` for Playwright capture). Exits 2 on any unhealthy entry.
  - `scripts/browser-agent/__fixtures__/form-fill/{ashbyhq.com,greenhouse.io}.html`: hand-curated minimal DOM for the probe.
  - 24 new tests across `form-fill.test.ts` (6), `dispatch.test.ts` (2), `probe.test.ts` (5), `loader.test.ts` (+1 for F.3 fields), `selector-health.test.ts` worker (6). All green: `pnpm vitest run packages/browser-agent apps/worker/src/selector-health.test.ts` -> 71/71 pass.
  - Not touched: `prisma/schema.prisma` (per rules; `Application.notes` reused for the stale tag, authoritative state is the audit_log row).

- **C-P2.4 build-code sandbox consumer wire** (session-ponytail, 2026-10-01, shipped 71e7d8a): resolves the 751307e TODO.
  - `packages/sandbox/src/index.ts`: TODO comment replaced with real consumer pointer.
  - `packages/shared/src/schemas/index.ts`: `+GeneratedBuildTaskSchema` (language | title | description | starter | tests | timeoutMs | difficulty).
  - `apps/api/src/modules/assessments/prompts/build-task-generator.ts`: local `renderBuildTaskPrompt(vars)` helper. Scope remediation: prompt was originally drafted in `packages/ai/src/prompts/` but that path is session-ai-infra's; relocated under the assessments module since it has a single consumer and does not need the shared registry.
  - `apps/api/package.json`: `+@careeros/sandbox: workspace:*` dep.
  - `apps/api/src/modules/assessments/assessments.service.ts`: `nextBuildTask`, `generateBuildTask`, `gradeBuildAttempt` (invokes `runSandboxed` with `starter + userCode + tests`, parses PASS/FAIL via `scoreBuildRun`, persists sandbox status + exit + wallTime to `attempt.gradingJson`); `BUILD_SEED` hand-seeded node + python tasks so the pool is non-empty before any LLM provider is wired.
  - `apps/api/src/modules/assessments/assessments.controller.ts`: `GET /assessments/build/next`, `POST /assessments/build/generate`, `POST /assessments/build/grade`.
  - `apps/api/src/modules/assessments/assessments.service.build.test.ts`: 8 tests, prove the sandbox is called with concatenated program, PASS/FAIL parsing maps to score, sandbox metadata persists, timeout/paused short-circuit to 0, parser handles edge cases.
  - Test command: `pnpm vitest run apps/api/src/modules/assessments/` (44/44 pass across the module; shared/sandbox/ai packages typecheck clean).
  - Deferred: streamed WSS test results to runner UI (needs apps/web Monaco wire), Playwright E2E submit-failing-then-correct (also apps/web), build-task LLM eval set (needs provider in CI). Real Docker exec covered by `SANDBOX_E2E=1` suite in `packages/sandbox/src/index.test.ts` and the C-P2.2 security suite.

- **F.2 follow-ups** (session-ponytail, 2026-10-01, not yet committed): closes the three deferrals noted on `DEFERRED.md:150` / `phase-6:26-32,144-145`.
  - Multipart resume per ATS: `AshbyAdapter` now `multipart/form-data` with a `json` part + `resumeFile` Blob (Ashby's documented file-attach shape); `GreenhouseAdapter` sends the resume PDF as a base64 `attachments[]` entry inline on the Harvest Candidates POST (Harvest API has no multipart file endpoint - the `ponytail:` comment in the adapter names the upgrade). PDF bytes rendered on demand from the Application's `resume_variant.contentJson` via `renderResumePdf` (no new storage round-trip; variant is small + render is deterministic + submit is interactive).
  - msw contract tests: `apps/api/src/modules/ats-submit/adapters/{ashby,greenhouse}.contract.test.ts` run the real adapter through MSW using realistic recorded-shape fixtures in `packages/testing/src/fixtures/ats/{ashby,greenhouse}.ts` (re-exported as `atsFixtures` from `@careeros/testing`). Scope: one happy + one failure per ATS, as spec'd. These replace the previously-deferred fixture work.
  - F.1 approval wire: `POST /ats-submit` now ENQUEUES an `ats_submit` approval item and returns 202 with `{approvalItemId, state, kind}`. `AtsSubmitService` registers itself as an `ApprovalsWorker` on `onModuleInit`; `onApproved(item)` deserializes the payload, calls `submit()`, and reports terminal state back via `approvals.markSent` / `markFailed`. `submit()` without `approvalItemId` (or with an item not in `approved` state) throws `BadRequestException` - no silent direct path.
  - Files touched: `apps/api/src/modules/ats-submit/**` (service + controller + module + both adapters + 2 contract tests + 1 approval-wire integration test), `packages/testing/src/{index.ts,fixtures/ats/**}`, `packages/testing/dist/**` (rebuilt from source). ApprovalsModule imported by AtsSubmitModule; no changes inside `approvals/**` (hook is one-way: AtsSubmitService -> ApprovalsService).
  - Tests: 23 ats-submit (was 12; +2 greenhouse attachment coverage, +2 ashby contract, +2 greenhouse contract, +5 approval-wire integration), 28 approvals (unchanged, re-verified green). Typecheck clean for ats-submit scope.
  - No prisma schema change needed; the `approval_items` table from F.1 already carries the payload JSON. No new runtime deps (msw + fast-check already installed; `FormData`/`Blob` are Node 20 globals).

- **Stream C: test backfill** (session-ponytail, 2026-10-01, not yet committed): closes four items from `plan/DEFERRED.md` (testing.md items 6 + 7, side-car fuzz; security.md item 8 ENCRYPTION_KEY exclusion).
  - `scripts/smoke/backup-byte-inspection.sh` (new, chmod +x): operator smoke that spins a throwaway `postgres:16-alpine` container, exports a sentinel `ENCRYPTION_KEY`, runs `scripts/backup.sh` against it, then (a) asserts the `postgres-*.dump.age` artifact starts with the `age-encryption.org/v1\n` header, (b) asserts no `PGDMP` magic or SQL keywords are visible in the raw ciphertext, (c) decrypts with the paired `age` identity, confirms the seeded sentinel row survives roundtrip, (d) asserts the `ENCRYPTION_KEY` sentinel does NOT appear anywhere in the decrypted dump, backup filenames, or `backup.log`. Guards skip cleanly without `age` / `age-keygen` / `docker` / `pg_dump` / `mc` / `tar` / `curl` / `jq` / `gzip`. Combined into one script per the brief's "combine if cleaner" clause: the sentinel-env setup is the same preamble as the byte-inspection, splitting would duplicate the whole postgres container boot.
  - `packages/email-parsers/src/parsers/{linkedin,indeed,naukri}.fuzz.test.ts` (3 new files): fast-check at 500 iters per parser (shrinking on). Each file runs two props: (a) the parser never throws across garbled HTML and every job it returns conforms to `EmailJobSchema`, (b) the `parseEmail` entry point with garbled from/subject/html always returns either `null` (unknown sender) or a `ParsedEmailSchema`-valid object. Noise arbitrary mixes plain string junk, malformed anchor tags, half-valid parser-specific URLs (comm/jobs/view, rc/clk?jk=, nma.naukri redirect wrappers), and random webUrls to exercise both the hit and miss paths. `ponytail:` comment names the 500-iter ceiling + raise condition.
  - `packages/testing/src/migration-safety.ts` (new): `assertMigrationSafety(migrationName, { sql, before, after, db, allowDestructive?, reviewedIn?, schema? })` scaffold. Static scanner (`scanDestructive`) flags `DROP TABLE`, `ALTER COLUMN ... TYPE`, `ALTER TABLE ... DROP COLUMN` with line numbers and refuses to proceed without explicit `allowDestructive: true` + `reviewedIn: '<ticket>'`. Row-count snapshot before + after via `information_schema.tables` + `COUNT(*)` per table; any count that decreases throws `MigrationSafetyError` with per-table before/after rowLoss payload. Caller supplies a `MinimalDb` (`$executeRawUnsafe` + `$queryRawUnsafe` — Prisma fits natively). SCAFFOLD, no auto-discovery; one migration = one test file calls this. Exported from `@careeros/testing`.
  - `packages/testing/src/migration-safety.test.ts` (new): 15 vitest cases cover scanner shapes (additive-only passes; DROP TABLE / ALTER COLUMN TYPE / DROP COLUMN detected; comments stripped; line numbers), row-count snapshot, additive migration passes, destructive refused without opt-in, opt-in without reviewedIn still refused, both-set accepted, silent row-loss (DELETE FROM) rejected, before/after hooks run in order, end-to-end "trivial no-op" (CREATE then DROP a scratch table with reviewedIn='self-test'). FakeDb stub (in-memory tables Map, honours CREATE / DROP / INSERT / DELETE) proves the scaffold's contract without needing a live postgres. Consumers wire real Prisma in their migration tests.
  - `packages/testing/src/index.ts`: `+assertMigrationSafety`, `+scanDestructive`, `+snapshotRowCounts`, `+MigrationSafetyError`, `+AssertMigrationSafetyOptions`, `+DestructiveFinding`, `+MinimalDb` exports; `packages/testing/dist/**` rebuilt.
  - Tests: `pnpm vitest run packages/email-parsers packages/testing/src/migration-safety.test.ts` -> 76/76 pass (61 email-parsers incl. 6 new fuzz props @ 500 iters each = 3000 property checks + 15 migration-safety). Testing + email-parsers packages typecheck clean.
  - No new runtime deps (fast-check already at root; `zod` already in email-parsers; shell script has no deps beyond existing operator-smoke tooling).

---

## Rules both sessions follow

1. Update the ownership map **before** starting a stream.
2. Mark your stream `shipped` with the commit SHA when done; move the row to "Shipped".
3. Do not touch paths owned by another session. If you need something there, add a note under "Cross-session requests".
4. Working tree has 125 modified files (parallel design-revamp session). Do not stage or commit anything you did not write.
5. `git commit --only <path>` always; never `git add .` or `git add -A`.
6. No em dashes in any user-facing string across the whole project.
7. After a stream ships, that session spawns a verifier/monitor; it does not self-certify.

---

## Cross-session requests

- **2026-10-01, session-ponytail -> session-ai-infra (FYI, no action):** C-P2.4 build-task-generator prompt was initially drafted under `packages/ai/src/prompts/build-task-generator.ts`; during remediation it was moved to `apps/api/src/modules/assessments/prompts/build-task-generator.ts` (single consumer, skips the shared registry). `packages/ai/src/prompts/index.ts` was reverted to HEAD. Nothing dropped in your lap; the shared `@careeros/ai` registry stays unchanged.

---

## Shared decisions log

(empty — append a dated line when both sessions agree on something like "sandbox wire reuses `UserLlmLimit` wrapper" so neither re-litigates it)
