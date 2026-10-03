# Career OS — Testing Spec

Cross-cutting spec for what to test, how, and when. Referenced from every phase file. If your PR adds code, it satisfies the relevant test type(s) with acceptance criteria met AND covered in CI.

**Premise:** the app is evidence-based and deterministic where possible; LLM only where needed. Unit tests are cheap and deterministic — pile them high. Integration tests against real Postgres/Redis catch pipeline bugs mocks miss. E2E is expensive; one golden flow per phase is enough.

**Non-goals:** we do not chase coverage numbers, do not run load tests until we hit a real bottleneck, do not do chaos or mutation testing.

---

## 1. Testing pyramid

```
         E2E (Playwright)                    ~15 total
                              ▲                (1 per phase + a few cross-phase)
                             ▲▲▲
                            ▲▲▲▲▲
                       Integration             ~80 tests
                     (Testcontainers)
                    ▲▲▲▲▲▲▲▲▲▲▲▲▲
                   ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲
                    Unit (Vitest)            all pure logic
              ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲

  Side-cars: LLM evals · backup-restore · migration forward-safety
             · sandbox security · a11y · visual regression · fuzz
             · property-based
```

---

## 2. Frameworks (locked)

| Concern | Choice | Why |
|---|---|---|
| Unit | **Vitest** | TS-native, fast, colocation-friendly, Vite ecosystem |
| Integration DB | **Testcontainers** (real Postgres/Redis/Qdrant/MinIO) | Mocks lie; real infra catches pipeline bugs |
| E2E browser | **Playwright** | Trace viewer, UI mode, parallelization, first-class TS |
| Visual regression | Playwright screenshot compare (`toHaveScreenshot`) | Same runner; no extra framework |
| A11y | **`@axe-core/playwright`** | Runs inside Playwright specs; WCAG 2.1 AA |
| External HTTP mocks (unit only) | **`msw`** | Same handlers in unit + storybook if needed later |
| Property-based | **`fast-check`** | Finds edge cases 200 example tests miss |
| Fuzz | `fast-check` + custom corpora | For parsers and injection-scan |
| LLM evals | Custom runner + Vitest wrapper | See §5 for pattern |
| Backup restore | Bash + Docker in GitHub Actions | Weekly cron |
| Load (deferred) | k6 | Only when we hit a bottleneck |

Never installed: Jest (Vitest replaces), Cypress (Playwright replaces), Mocha/Chai, Enzyme, Puppeteer (Playwright's browser layer suffices).

---

## 3. The 10 test types

### 1. Unit tests — Vitest
**What:** pure functions. Formulas, aggregators, parsers, encryption, redaction, schemas, XP calculations, level bands, priority formula.

**Acceptance:**
- [ ] Colocated as `foo.test.ts` next to `foo.ts`
- [ ] Every non-trivial branch has an assert-based test (per AGENTS.md ponytail rule)
- [ ] No DB, no network, no filesystem — pure input → output
- [ ] Runs in < 100ms per test; whole unit suite < 60s
- [ ] `pnpm test:unit`

### 2. Integration tests — Vitest + Testcontainers
**What:** real Postgres + Redis + Qdrant + MinIO in Docker for the duration of the test file. Job pipeline end-to-end, worker jobs, migration rollouts, Prisma queries against real schema.

**Acceptance:**
- [ ] Under `apps/api/test/integration/` and `apps/worker/test/integration/`
- [ ] Testcontainers spins up per test file (or reuse per describe via `beforeAll`)
- [ ] Every test wrapped in a transaction that rolls back
- [ ] Migrations run automatically before tests
- [ ] No mocking of DB/Redis/Qdrant — those are the point
- [ ] Runs in < 5s per test file; whole integration suite < 5 min
- [ ] `pnpm test:integration`

### 3. E2E browser tests — Playwright
**What:** the golden-flow per phase from a real browser against a built (production-mode) API + web + worker stack.

**Acceptance:**
- [ ] Under `apps/web/e2e/`
- [ ] Uses Page Object Model — one class per page in `apps/web/e2e/pages/`
- [ ] Zero direct selectors in tests — only page-object methods
- [ ] Data-testid attributes only for element selection (no CSS/XPath/text)
- [ ] Auth via storage-state fixture (sign in once, reuse)
- [ ] Per-test deterministic DB via `pnpm seed:test` + per-worker transactional isolation
- [ ] `fullyParallel: true`
- [ ] Retries: **0** in CI (flakes = bugs, not "flaky")
- [ ] Trace + video + screenshots uploaded on failure
- [ ] `pnpm test:e2e` for headless, `pnpm test:e2e:ui` for local UI mode

**Phase golden flows** (must exist by phase completion):
- P0: wizard end-to-end + sign-in after setup
- P1: connect repo → skills appear on dashboard
- P2: submit knowledge attempt → skill state shifts
- P3: view market brief with real source links
- P3.5: pair agent → run first discovery task → job lands
- P4: match → generate resume → fact-check passes → PDF renders
- P5: schedule daily brief → confirm Slack POST fired (mock server)
- P6: approval queue submit dry-run

### 4. LLM eval tests — custom runner + Vitest
See §5 for the full pattern.

**Acceptance:**
- [x] Fixtures + judge live in TS under `packages/ai/src/evals/<prompt>/` (`fixtures.ts` + `judge.ts`), not `examples.json`/`evaluator.ts` — the TS shape is what landed (C-P1.4c skill-extract 24 fixtures, C-P4.7e fact-check 15).
- [ ] 20+ examples per critical prompt (skill-extract ✅ 24, fact-check ✅ 15; injection-scan / resume-tailor / question-generator / assessment-grader still open)
- [x] Assertions are structural + property-based, never exact-string (judges score F1/precision/recall + kept/dropped counts, per `judge.ts`).
- [ ] `pnpm eval:ai` — the suite runs via `pnpm --filter @careeros/ai test:evals`; a root `eval:ai` alias and a `--prompt=` filter are still open.
- [ ] CI: on change to `packages/ai/prompts/` or `packages/ai/agents/` → run affected evals; block on regression. Not wired into `pr.yml` yet.
- [x] Nightly (`.github/workflows/nightly-evals.yml`): runs the full eval suite, merges per-suite parts into `junit.xml` + `summary.json`, compares the case pass rate to the previous 7 days of `eval-summary` artifacts, and opens/updates an issue when the drop exceeds 5pp. With no `DEEPSEEK_API_KEY` it runs `EVAL_MOCK=1` and marks the result **mock** (synthetic — does not validate model quality), never a fake live pass.
- [ ] Response cached by prompt hash to avoid hammering paid providers in CI.

### 5. Contract tests (external adapters)
**What:** each `JobSourceAdapter`, LLM provider adapter, ATS adapter, Slack/Gmail integration verified against recorded fixtures. Fixtures re-recorded periodically to catch upstream API drift.

**Acceptance:**
- [x] Fixtures live at `packages/job-pipeline/__contracts__/<adapter>.snapshot.json` (ashby / greenhouse / arbeitnow / remotive). Adzuna is fully mocked via MSW (no fixture) because upstream requires paid creds; see `packages/job-pipeline/src/adapters/adzuna.contract.test.ts` (C-P3.6a commit 5d19b79).
- [x] Contract test loads fixture → runs adapter → asserts output shape (Zod at `packages/job-pipeline/src/adapters/schemas.ts`). One `*.contract.test.ts` per adapter (C-P3.6a).
- [x] Weekly cron `.github/workflows/adapter-contract.yml` hits live upstreams and revalidates against the schemas (C-P3.6b commit 03a5ebb).
- [ ] Recorded via `pnpm fixtures:record` (hits real API with test creds) — snapshot capture is currently one-off in the contract-test authoring flow; a `fixtures:record` script is deferred.
- [ ] `pnpm test:contract` script — contract tests currently run via the shared `pnpm test` root; a dedicated script is deferred.

### 6. Migration forward-safety tests
**What:** every migration is forward-safe. Given a DB seeded to version N and code from version N+1, migrations apply cleanly and data survives.

**Acceptance:**
- [ ] `apps/api/test/migrations/` — one test per migration
- [ ] Test seeds an "old" DB dump, runs `prisma migrate deploy`, asserts:
  - No error
  - Row counts unchanged in existing tables
  - New columns/tables populated per migration logic
- [ ] "Old DB dumps" checked in under `apps/api/test/migrations/dumps/`
- [ ] CI runs on every PR touching `prisma/migrations/`

### 7. Backup / restore CI test
**What:** weekly job restores latest backup into fresh volumes and boots the stack, verifies parity.

**Acceptance:**
- [x] `.github/workflows/restore-test.yml` — weekly cron (Mondays 03:00 UTC, C-P0.5b). Real round-trip: migrate + `seed:test` → `scripts/manifest.sh` snapshots row counts → `scripts/backup.sh` writes an age-encrypted dump with an ephemeral in-job key → wipe volumes (`down -v`) → fresh datastores → `scripts/restore.sh` rehydrates → boot API. No repo secret required; skips loudly (never silently) only when Docker/scripts are unavailable.
- [x] Fresh Docker volumes → `scripts/restore.sh` with test backup → `docker compose up -d`
- [x] Assert `setup_state = complete` (queries `setup_state` for the seeded user after boot)
- [x] Assert row counts match snapshot manifest (`scripts/verify-restore-parity.sh`)
- [x] Assert `age` encryption failed cleanly with wrong key (negative test; `restore.sh` now dies explicitly on decrypt failure instead of falling through)
- [x] Fail → GitHub issue auto-filed (search-or-create on the `restore-test` label)

### 8. Sandbox security tests
**What:** P2 code sandbox limits enforced. Memory bomb killed. Network blocked. Fork bomb killed. Timeout respected.

**Acceptance:**
- [x] `packages/sandbox/src/security.test.ts` — Vitest + Docker (C-P2.2a commit 12cf32f; suite colocated in `src/` rather than `test/` per the repo colocation rule). Companion operator smoke: `packages/sandbox/security-smoke.sh`.
- [x] Test cases (each must be killed or blocked):
  - Memory: `let a = []; while(true) a.push(0)` → OOM-killed within limit
  - Network: `fetch('https://google.com')` → DNS blocked
  - Fork bomb: `:(){ :|:& };:` (bash-equivalent per language) → pids-limit kills
  - Wall clock: `while(true){}` → SIGKILL at 30s
  - Filesystem escape: `require('fs').readFile('/etc/passwd')` → EACCES
- [x] Each test runs in real Docker; not simulated (`packages/sandbox/src/docker.test.ts`, `security.test.ts`).

### 9. Visual regression
**What:** Playwright screenshot compare on every phase's key screens. Design consistency across releases.

**Acceptance:**
- [ ] `apps/web/e2e/visual/` — per screen
- [ ] Baseline screenshots checked in
- [ ] `toHaveScreenshot()` with 1% pixel tolerance
- [ ] Both light + dark theme
- [ ] Fixed viewport (1440x900), stable fonts (Inter subset shipped)
- [ ] Update baseline via `pnpm test:visual --update-snapshots`
- [ ] CI: fails on diff; artifact uploaded for review

### 10. A11y tests
**What:** every screen in golden flows passes axe-core with WCAG 2.1 AA.

**Acceptance:**
- [ ] `@axe-core/playwright` integrated
- [ ] Every Playwright spec calls `await checkA11y(page)` at least once per screen visited
- [ ] Rules: WCAG 2.1 AA + best-practice tags
- [ ] Zero violations required; exclusions declared per-page in code with justification comment

### Side-cars (worth having)

**Property-based tests** (`fast-check`):
- KnowledgeAggregator: for any evidence sequence, proficiency ∈ [0, 100], confidence ∈ [0, 1], historical_demonstrated is monotonically non-decreasing
- Job pipeline dedupe: for any (canonical_url, source_id) collision set, result contains exactly one primary
- Skill priority: for any inputs, `learning_priority` is finite and non-negative

**Fuzz tests:**
- Email parsers (P5): random HTML → parser never crashes, output validates against schema
- Injection-scan (P3): random prompts → scan returns a score, never throws

---

## 4. Test data strategy

```
Fixtures:
  packages/*/test/__fixtures__/       ← unit test data
  packages/job-pipeline/adapters/*/fixtures/  ← recorded adapter responses
  packages/ai/evals/*/examples.json   ← LLM eval sets
  apps/api/test/migrations/dumps/     ← "old" DB dumps for forward-safety
  scripts/seed-dev.ts                 ← realistic candidate for dev
  scripts/seed-test.ts                ← deterministic minimal for e2e
```

Rules:
- **No real user data** in tests, ever. Redaction verified in unit test against known secret patterns.
- **Deterministic** — same inputs, same outputs, no `Date.now()` or `Math.random()` without seeding
- **Small** — every fixture should fit in a single reviewable PR
- **Refreshable** — `pnpm fixtures:record` re-records adapter fixtures against real APIs

---

## 5. Testing LLM code (the tricky part)

Non-deterministic outputs break "assert exact result." The pattern:

### Never assert exact strings

Instead:

| Assertion type | What you check | Example (skill-extract) |
|---|---|---|
| **Schema** | Response validates against Zod | `SkillExtractSchema.parse(response)` |
| **Property** | Output has required invariants | `2 ≤ skills.length ≤ 20` |
| **Grounding** | Every claim traces to input fact | `every(ref => facts.ids.has(ref))` |
| **Non-hallucination** | Named entities in output ⊆ input | `every(company => jd.text.includes(company))` |
| **Pass rate** | % of golden set producing acceptable output | `pass_rate ≥ 0.9` on 20+ examples |
| **Drift** | Pass rate week-over-week | `abs(current - baseline_7d) < 0.05` |

### Eval file structure

```
packages/ai/evals/skill-extract/
├── examples.json         # 20+ {input, expected_properties}
├── evaluator.ts          # (result, expected) → {passed, reasons[]}
└── skill-extract.eval.ts # Vitest wrapper — one describe per example
```

### CI wiring

- On PR touching `packages/ai/prompts/` OR `packages/ai/agents/`:
  - Determine affected prompts (via import graph)
  - Run affected evals against **cached responses** (keyed by prompt hash)
  - If any cached response missing → hit real API once, cache
  - Block merge on regression
  - **Status:** not wired in `pr.yml` yet.
- Nightly (`.github/workflows/nightly-evals.yml`):
  - Runs `pnpm --filter @careeros/ai test:evals` (skill-extract + fact-check; 39 eval cases today)
  - Suites write per-suite part files; the vitest global setup merges them into `junit.xml` + `summary.json` so all suites land (not just the last one to finish)
  - Baseline = average pass rate of `eval-summary` artifacts from the previous 7 days, downloaded via the Actions artifacts API; `scripts/eval-drift.mjs` computes the delta and writes `drift.json`
  - Alert (issue, label `eval-drift`) and fail the job if the drop exceeds 5pp
  - `DEEPSEEK_API_KEY` set → live provider (`setup.live.ts` registers it); absent → `EVAL_MOCK=1`, and the summary/JUnit/job label the run **mock** so a synthetic pass never masquerades as model validation
  - Deferred vs the original spec: writing to an `eval_results` table and the DeepSeek + Ollama fallback matrix; baseline is artifact-based, not DB-based

### Low-temperature settings

- Evals always run with `temperature=0` (or provider min) for maximum determinism
- Production prompts use their tuned temperature; eval-vs-prod gap flagged in reports

---

## 6. E2E maintainability rules

E2E rots fastest. These rules prevent it:

1. **Page Object Model** — one class per page in `apps/web/e2e/pages/`
2. **Data-testid attributes only** — never CSS, never XPath, never text-match (breaks on copy tweaks)
3. **Auto-generated test IDs** via convention — component `<UserMenu>` renders `data-testid="user-menu"`; ESLint rule enforces
4. **Auth fixture** — sign in once per file via `storageState`, not per test
5. **Deterministic test data** — `pnpm seed:test` gives every test the same DB starting state
6. **Per-worker transactional isolation** — one Postgres schema per Playwright worker; test wraps in transaction that rolls back
7. **One golden flow per phase** in CI critical path — smaller flows in unit/integration
8. **Trace viewer** — every CI failure uploads `trace.zip`; open with `pnpm playwright show-trace`
9. **`fullyParallel: true`** with worker isolation
10. **Retries: 0.** Flakes are bugs.

---

## 7. CI pipeline

```yaml
On PR:
  1. typecheck + lint             ~30s   required
  2. unit                         ~60s   required
  3. integration (Testcontainers) ~4min  required
  4. build docker images          ~2min
  5. Trivy scan                   ~1min  required
  6. Playwright golden flows      ~6min  required (against built images)
  7. Visual regression            (in Playwright)
  8. A11y                         (in Playwright)
  9. AI evals (if triggered)      ~2min  required when triggered
 10. pnpm audit + CodeQL          ~2min  required

On main:
  All of above +
  Deploy to staging (if configured)

Weekly cron:
  ▸ Full LLM eval suite (all prompts × all providers)
  ▸ Backup restore end-to-end
  ▸ Contract fixture re-record (PR opened if drift)
  ▸ Renovate PRs

On tag:
  All of above +
  ▸ SBOM (Syft CycloneDX)
  ▸ Cosign sign images
  ▸ GitHub Release with SHA256SUMS
```

**Wall-clock budget:** PR pipeline **< 15 min**. Past 20 → split into parallel jobs.

---

## 8. Flaky test policy

- Any test failing twice in a week on `main` → auto-issue via GitHub Actions with trace attached
- Not fixed within 7 days → skip with `it.skip.reason("flaky-quarantine-#N")`
- Skipped tests reviewed monthly
- **Never** `test.retry(N)` — that hides bugs

## 9. Test observability

- Vitest JSON report → CI artifact
- Playwright HTML report + trace → CI artifact per run
- Weekly slowest-20 tests (`--reporter=verbose --outputFile=timings.json`); anything > 5s unit or > 30s integration flagged
- Flake tracker: GitHub Actions job that queries failing runs on `main`

## 10. Coverage philosophy

- **No coverage percentage target.** Numbers game themselves.
- **Behavior coverage: complete.** Every checkbox in a phase file has at least one verifying test. That is what "done" means.
- **Exclusions:** generated code, `.stories.tsx`, `.d.ts` — noted in `vitest.config.ts`

---

## 11. Local dev workflow

```bash
pnpm test              # unit + integration (fast feedback)
pnpm test:watch        # Vitest watch mode
pnpm test:e2e:ui       # Playwright UI mode (best for e2e work)
pnpm test:evals        # LLM evals (EVAL_MOCK=1 by default; export DEEPSEEK_API_KEY + EVAL_LIVE=1 for a real run)
pnpm test:visual --update-snapshots  # accept baseline changes
pnpm test:a11y         # a11y checks only
pnpm fixtures:record   # re-record adapter fixtures (needs real creds)
```

Pre-commit hook (via `lefthook` or `husky`) runs `typecheck + lint + unit` on staged files only.

---

## 12. Phase coverage matrix

| Phase | New test types landing |
|---|---|
| **P0** | Test infra: Vitest + Testcontainers + Playwright + MSW + fast-check setup, seed-test script, CI workflows, first Playwright golden flow, backup restore weekly cron, `pnpm test:*` scripts |
| **P1** | Property-based for aggregator + priority formula, first LLM eval set (skill-extract), integration for GitHub sync worker, e2e connect-repo golden flow |
| **P2** | Sandbox security tests (all 5 scenarios), LLM evals (assessment-grader, question-generator, rubric-evaluator), e2e knowledge attempt |
| **P3** | Property-based for pipeline dedupe, fuzz for injection-scan, contract tests per adapter (Ashby/Greenhouse/Adzuna/Remotive/Arbeitnow/JSearch), LLM eval (skill-extract on jobs), e2e market brief |
| **P3.5** | Agent unit tests (task-runner, wss-client, keytar wrapper), agent script tests against fixture HTML, e2e pairing flow (mock WSS) |
| **P4** | PDF/DOCX round-trip extraction tests, ATS-lint per-rule tests, visual regression on resume templates, LLM evals (resume-tailor, cover-letter, fact-check), state-machine coverage (all valid + invalid transitions), e2e match→resume→export |
| **P5** | Fuzz for email parsers, contract for Slack/Gmail (fixture-recorded), LLM eval (email classifier), Slack signing unit, e2e daily-brief trigger |
| **P6** | Approval-queue state-machine coverage, selector-health probe unit, agent form-fill against fixture site, restore-test wired into CI (not just script), e2e approval→submit dry-run |

---

## What operators / users can rely on

- Every user-facing feature has an e2e test covering the golden flow.
- Every migration is forward-safe or the release doesn't ship.
- Every LLM prompt has an eval set; regressions block merge.
- Every backup is restorable — proven weekly, not just claimed.
- Sandboxes prove their limits are real, not documented.

## What agents editing this codebase MUST do

- Add tests for the checkbox you're ticking; unchecked ≠ done.
- If you touch a prompt or agent, run affected evals locally before pushing.
- If you break an e2e test, fix it — don't `.skip` unless quarantining with a filed issue.
- If you change a fixture, note *why* in the PR description.
- If a test is slow, ask why before accepting it.
