# Phase-status drift audit

Spot-check of plan/PLAN.md phase status board against actual code. Not a full review.

---

## P0 — Install & first-run wizard (claim: functional, hardening in flight)

### Claim: 14-step wizard route tree
- Code location: `apps/web/src/app/(setup)/setup/01-preflight` .. `14-complete`
- Reality: shipped
- Evidence: all 14 numbered step folders present under `apps/web/src/app/(setup)/setup/`
- Test coverage: partial — `apps/web/e2e/pre-setup.spec.ts`, `post-setup.spec.ts` (no full-wizard Playwright with storage-state, matches deferred item in plan)

### Claim: Setup API module
- Code location: `apps/api/src/modules/setup/setup.{controller,service}.ts`
- Reality: shipped
- Evidence: controller 169 lines, service 53 lines, no TODO/FIXME/not-implemented
- Test coverage: no dedicated unit test file

### Claim: Recovery flow
- Code location: `apps/api/src/modules/recovery/`, `apps/web/src/app/(setup)/setup/13-recovery`
- Reality: shipped
- Evidence: recovery module exists in API, matching wizard step
- Test coverage: no

---

## P1 — Personal intelligence (claim: slices 1-8 shipped + verified)

### Claim: Dashboard + skill graph
- Code location: `apps/web/src/app/(app)/dashboard/page.tsx`, `apps/web/src/app/(app)/skills/{page.tsx,[id]}`
- Reality: shipped
- Evidence: pages exist; skills has detail route; API `skills.service.ts` 127 lines
- Test coverage: no dedicated skills.service test (rules/property tests exist for shared `knowledge-rules` only)

### Claim: GitHub ingest
- Code location: `apps/api/src/modules/integrations/github/github.service.ts`
- Reality: shipped
- Evidence: 134-line service, no not-implemented markers
- Test coverage: no

### Claim: Usage/costs + Redis-cached aggregation
- Code location: `apps/api/src/modules/usage/{usage.service.ts, usage.cache.ts, usage.controller.ts}`
- Reality: shipped
- Evidence: service 326 lines + cache module; settings/usage page present
- Test coverage: yes — `apps/api/src/modules/usage/usage.service.test.ts`

### Claim: AI safety pkg (wrap, evals, grounded)
- Code location: `packages/ai/src/{wrap,evals,grounded,hallucination,sensitivity}.ts`
- Reality: shipped
- Evidence: all files present; 3 test files (wrap/evals/grounded) plus 2 eval subtests (question-generator, knowledge-grader)
- Test coverage: yes

### Claim: Embeddings module + settings screen
- Code location: `apps/api/src/modules/embeddings/embeddings.service.ts`, `apps/web/src/app/(app)/settings/embeddings/page.tsx`, `packages/embeddings/`
- Reality: shipped
- Evidence: 87-line service + settings screen present
- Test coverage: no unit test on API service (pkg tests unknown)

### Claim: PII field encryption
- Code location: `packages/secrets/src/{field,encryption,master-key}.ts`
- Reality: shipped
- Evidence: field.ts implements purpose-binding + IV; guards for tamper/malformed present
- Test coverage: yes — `field.test.ts` delegates to `field.demo.ts` (8-scenario assert). Thin test wrapper but real demo asserts

### Claim: Settings suite screens 52/53/54/62
- Code location: `apps/web/src/app/(app)/settings/{embeddings,providers,usage,workers,integrations,job-preferences}/page.tsx`
- Reality: shipped
- Evidence: 6 subroute pages present under settings/
- Test coverage: no

---

## P2 — Assessment arena (claim: slices 1-12, 5 types + boss battles + corpus walking-skeleton)

### Claim: 5 assessment types via `runLlmGraderOrFallback`
- Code location: `apps/api/src/modules/assessments/assessments.service.ts`
- Reality: shipped
- Evidence: `runLlmGraderOrFallback` defined at line 943, called at 1010 (rubric) and 1263 (debugging); 5 web routes present (`knowledge`, `code-review`, `system-design`, `debugging`, `mock-interview`)
- Test coverage: partial — `packages/shared/src/{assessment,rubrics,knowledge-rules,knowledge-rules.property}.test.ts` cover shared scoring; no direct assessments.service.test.ts

### Claim: Boss battles — server-authoritative 30-min timer, L10/25/50/75/100 milestones
- Code location: `apps/api/src/modules/assessments/assessments.service.ts:1499-1779`
- Reality: shipped
- Evidence: `bossBattle` prisma model queries at :1499, :1543, :1559, :1576; `expiresAt = startedAt + durationS * 1000` at :1775 (server-computed); web route `arena/boss/[id]` present
- Test coverage: no dedicated boss-battle test file

### Claim: Corpus walking-skeleton — `system-design-primer` (CC-BY-4.0), LLM keyPoints, promptHash dedupe
- Code location: `apps/api/src/modules/corpus/{corpus.service.ts, adapters/system-design-primer.ts}`
- Reality: shipped
- Evidence: adapter + service (178 lines) present; only 1 adapter (matches "more adapters parked" caveat)
- Test coverage: yes — `system-design-primer.test.ts`

---

## P3 — Market engine (claim: slices 13-18, pipeline + attribution + skill extraction + match score + prefs + freshness + weekly brief)

### Claim: Job pipeline pkg + Remotive adapter
- Code location: `packages/job-pipeline/src/{index.ts, adapters/remotive.ts}`
- Reality: partial (as documented in plan)
- Evidence: `packages/job-pipeline/src/index.ts` is only 2 lines; only 1 adapter (`remotive`), plan claims Ashby/Greenhouse/Adzuna/Arbeitnow locked but doesn't yet mark them shipped so this matches "more adapters defer" caveat
- Test coverage: yes — `remotive.test.ts`

### Claim: Match score + skill extraction + freshness + attribution
- Code location: `apps/api/src/modules/jobs/jobs.service.ts` (409 lines)
- Reality: shipped
- Evidence: imports `matchScoreForJob` from `@careeros/shared` (:3); `extractSkillsBatch` (:295), `extractSkillsForJob` (:336), freshness comment (:47, :62), `attribution` field (:89)
- Test coverage: yes — `packages/shared/src/match.test.ts`

### Claim: Weekly market brief — stats → LLM synthesis → URL post-filter → persisted, rendered at /brief
- Code location: `apps/api/src/modules/market-brief/market-brief.service.ts` (259 lines), `apps/web/src/app/(app)/brief/page.tsx`
- Reality: shipped
- Evidence: service + web page both present
- Test coverage: no dedicated market-brief test file

---

## P4 — The hunt (claim: slices 19-23, tailored resume + fact-check + cover letter + PDF export + tracker)

### Claim: Tailored resume + fact-check gate (missing-verdict-drop default)
- Code location: `apps/api/src/modules/resume-variants/resume-variants.service.ts` (430 lines)
- Reality: shipped
- Evidence: `DroppedBullet` type (:34); "Hallucination guard" (:164); "Fact-check dropped every bullet" branch (:199); "no verdict returned by fact-check" drop (:313)
- Test coverage: yes indirectly — `packages/ai/src/grounded.test.ts`; no unit test on resume-variants service directly

### Claim: Cover letter
- Code location: `apps/api/src/modules/cover-letters/cover-letters.service.ts` (372 lines), `apps/web/src/app/(app)/cover-letters/[id]/`
- Reality: shipped
- Evidence: service + detail route present
- Test coverage: no

### Claim: PDF export via React-PDF, one template (ats-first)
- Code location: `packages/resume-render/src/{index.ts, templates/ats-first.tsx}`
- Reality: shipped
- Evidence: `renderResumePdf` uses `renderToBuffer` from `@react-pdf/renderer`; only `ats-first.tsx` template (matches "more templates defer" caveat)
- Test coverage: no

### Claim: Application tracker — 6 states, canTransition guards, `/applications` UI, state chips, transitions
- Code location: `apps/api/src/modules/applications/applications.service.ts` (240 lines), `apps/web/src/app/(app)/applications/page.tsx`, `packages/shared/src/applications.ts`
- Reality: shipped
- Evidence: `APPLICATION_STATES` + `canTransition` imported (:3-4); guard at `applications.service.ts:147`; demo/test asserts 6+ transition scenarios
- Test coverage: yes — `packages/shared/src/applications.test.ts` (delegates to applications.demo.ts with real asserts)

---

## Drift summary

Claimed done but partial/missing/thin:

- P0: no full-wizard Playwright storage-state test (already listed as deferred in plan, not drift)
- P1 embeddings: `apps/api/src/modules/embeddings/embeddings.service.ts` has no adjacent test file; safety net lives in the shared pkg
- P1 GitHub ingest: `apps/api/src/modules/integrations/github/github.service.ts` (134 lines) has no test file — a real fetch service with zero unit coverage
- P1 skill graph: `apps/api/src/modules/skills/skills.service.ts` (127 lines) has no adjacent test; only shared knowledge-rules test exists
- P2 assessments.service.ts (2029 lines) has NO direct test file — the largest single service in the repo relies entirely on shared-package tests
- P2 boss battles: no dedicated test file exercising the server-authoritative timer, milestone logic, or expiry transition — a claimed anti-cheat surface with zero regression net
- P3 job pipeline: `packages/job-pipeline/src/index.ts` is 2 lines; the "pipeline" is really just one adapter. Plan text is honest ("more adapters defer") but the "pipeline" framing overstates what's in the package
- P3 market-brief: 259-line service with no test file
- P4 resume-variants: 430-line fact-check flow has no direct service test; only shared grounded.test.ts covers the primitive
- P4 cover-letters: 372-line service with no test file
- P4 PDF render: `renderResumePdf` has no test — a binary-output path with no golden

None of the checked routes/services are stubs. No `it.skip`, no `throw new Error("not implemented")` in main flows (only 1 documented "adapter X not implemented" for non-DeepSeek providers, which matches the locked decision). All claimed screens exist. The real drift is a **test-coverage gap**, not a code-existence gap: 10 of the largest/most claim-heavy services have no adjacent unit test.
