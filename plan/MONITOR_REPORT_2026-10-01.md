# Monitor Report — 2026-10-01

## Overall verdict
SAFE TO COMMIT 3 OF 4 (streams 2, 3, 4 clean; stream 1 has a known scope violation into packages/ai that orchestrator must adjudicate before commit)

## Pre-audit git state
- git status short count: 183 (grew from baseline ~125 as expected; all new entries are from the 4 streams + parallel sessions)
- last 3 commits (unchanged, no new commits from implementers):
  - a6ff8f8 plan-sync: parallel design-revamp session done; feature UIs still needed
  - baa58e0 plan-sync: F.2 shipped
  - 72b318f plan-sync: F.2 + E.5b + ENCRYPTED_FIELDS + CI hardening + docs batch 2

## Per-stream audit

### Stream 1: C-P2.4 sandbox wire
- Scope compliance: VIOLATIONS (pre-flagged by agent)
  - `packages/ai/src/prompts/build-task-generator.ts` (NEW file, 40 lines) — owned by session-ai-infra per SESSION_COORDINATION.md:25
  - `packages/ai/src/prompts/index.ts` (+1 line, registers the new prompt) — same ownership
  - All other files inside declared scope (`packages/sandbox/src/index.ts`, `apps/api/src/modules/assessments/*`, `packages/shared/src/schemas/index.ts`, `apps/api/package.json`)
  - Note: `apps/api/package.json` ALSO gained `@careeros/email-parsers` — that line is from a different session (grep shows import in email-ingest.service.ts), NOT Stream 1
- Shortcut check: PASS
  - TODO at `packages/sandbox/src/index.ts:1` from commit 751307e is resolved (replaced with "C-P2.4: consumed by..." pointer comment)
  - `assessments.service.ts:1701` calls real `this.runSandbox(...)` which defaults to `runSandboxed` from `@careeros/sandbox`; test seam is a protected field with a `ponytail:` comment naming the ceiling and upgrade path — compliant
  - `BUILD_SEED` hand-seeded corpus is real (not a stub); 8 new tests exercise PASS/FAIL parsing, sandbox call shape, timeout/paused short-circuit, metadata persistence
- Tests: 44/44 pass (ran: `pnpm vitest run apps/api/src/modules/assessments/`); 8 new tests on `assessments.service.build.test.ts` matches agent claim
- Em dashes: 1 found in agent-added code — `apps/api/src/modules/assessments/assessments.service.ts:1529` ("`question` with kind='build' — `description` in `prompt`") — JSDoc comment, not user-facing string, orchestrator discretion
- Dep adds: `+@careeros/sandbox: workspace:*` on apps/api/package.json → docker rebuild `--renew-anon-volumes` required for api
- Verdict: NEEDS REMEDIATION — the two packages/ai files are session-ai-infra's territory. Orchestrator should either (a) file a cross-session request to session-ai-infra to pick up the file as-is, or (b) commit the ai files separately via that session, or (c) accept the cross-session land and note in SESSION_COORDINATION.md. The sandbox + assessments + shared changes themselves are production-ready.

### Stream 2: F.3 form-fill
- Scope compliance: PASS (minor expansion pre-flagged)
  - All files within declared scope except `apps/worker/src/main.ts` (agent pre-flagged — needed to wire the queue+worker boot; 65 added lines, all additive, no scope collision)
  - `apps/worker/package.json` dep add pre-flagged
- Shortcut check: PASS
  - `ashby-apply.ts` + `greenhouse-apply.ts`: REAL, delegate to shared `runFormFill` engine with domain guard (not stubs)
  - `linkedin-easy-apply.ts` + `indeed-easy-apply.ts` + `naukri-apply.ts`: STUBS with `ponytail:` comments naming ceiling (not-yet-captured DOM) and upgrade path (capture modal/iframe/region fixtures)
  - No new TODO/FIXME introduced in Stream 2 files (one pre-existing TODO in `scripts/browser-agent/probe-linkedin-selectors.ts` is from D.1, not F.3)
- Tests: 71/71 pass (ran: `pnpm vitest run packages/browser-agent apps/worker/src/selector-health.test.ts scripts/browser-agent`); narrow command (minus scripts/browser-agent) yields 59/59, agent's 71 claim verified when scripts are included
- Em dashes: none in Stream 2's added lines; pre-existing dashes in `probe.ts:98`, `form-fill.ts:16`, `selector-health.worker.ts:33` are code comments
- Dep adds: `+@careeros/browser-agent: workspace:*` on apps/worker/package.json → docker rebuild `--renew-anon-volumes` required for worker
- Verdict: APPROVED

### Stream 3: F.2 submit polish
- Scope compliance: PASS
  - All files within declared scope: `apps/api/src/modules/ats-submit/**`, `packages/testing/src/{index.ts,fixtures/ats/**}`
  - approvals/ not touched (hook-only wire is one-way import; `git diff --stat apps/api/src/modules/approvals/` empty)
- Shortcut check: PASS
  - Ashby adapter: real `new FormData()` + `new Blob(..., { type: 'application/pdf' })` POST (ashby.adapter.ts:50-54), uses Node 20 globals
  - Greenhouse adapter: real base64 `attachments[]` on Harvest POST (greenhouse.adapter.ts:52-56) with `ponytail:` comment naming upgrade path to multipart if Greenhouse ever ships that endpoint
  - Approval gate: `AtsSubmitService.submit()` throws `BadRequestException` if `!input.approvalItemId` (ats-submit.service.ts:213-217), then `assertApproved()` requires row.state === 'approved' or throws (ats-submit.service.ts:434-452) — real enforcement, no stub
  - msw contract tests use realistic recorded shapes in `packages/testing/src/fixtures/ats/`
- Tests: 51/51 pass (23 ats-submit + 28 approvals, matches agent claim); ran `pnpm vitest run apps/api/src/modules/ats-submit apps/api/src/modules/approvals`
- Em dashes: none in Stream 3 files
- Dep adds: none (FormData/Blob are Node 20 globals per agent note; msw+fast-check pre-installed)
- Verdict: APPROVED

### Stream 4: F.8 data portability
- Scope compliance: PASS
  - All files within declared scope: `apps/api/src/modules/me/**`, `apps/api/src/common/storage.service.ts`, `infra/docker/Dockerfile.api`, `packages/testing/**` (via `startInfra` reuse; no new file in packages/testing from this stream)
- Shortcut check: PASS
  - Real `age -r <recipient>` via `child_process.spawn` in `me.service.ts:270-292` (ageEncrypt function); writes plaintext to stdin, collects ciphertext from stdout, rejects with stderr on non-zero exit
  - Header check at `me.service.ts:204` asserts first 21 bytes equal `age-encryption.org/v1` before accepting result (guards against silent plaintext passthrough)
  - Integration test does full round-trip: seeds 3 resumeFact + 1 careerGoal + 2 xpEvent → `exportToStorage` → fetches presigned URL → asserts age v1 header → `age -d` with matching identity → recomputes per-table sha256 against manifest → `deleteUser` → `assertDeletedForUser()` → asserts parity.nonZero === [] (me.storage.integration.test.ts:162-218)
  - Skip guard is explicit and verifiable: `TESTCONTAINERS_E2E=1 && isDockerAvailable() && isAgeAvailable()` combined; skip-guard test always runs and asserts the boolean is well-formed
- Tests: 8 passed, 1 skipped (ran: `pnpm vitest run apps/api/src/modules/me`); AGENT CLAIM WAS "18 unit + 1 integration" — ACTUAL IS 7 pre-existing unit + 1 new skip-guard unit + 1 skipped integration = 9 total. `git diff apps/api/src/modules/me/me.service.test.ts` adds ZERO new `it(...)` cases (only wires `fakeStorage()` into existing ctors). Agent overclaimed test coverage by ~10; the production code is still real + the integration test exists and is well-shaped, but the "18 unit tests" claim is not supported by the file
- Em dashes: none in Stream 4's added lines (pre-existing em dashes in `storage.service.ts:34,143` are comments, not from this stream)
- Dep adds: none to package.json; Dockerfile.api added `age` to `apk add` → docker rebuild api with `--renew-anon-volumes` required
- Verdict: APPROVED WITH CAVEAT — code is real, integration test is real, but agent's test-count claim (18 unit) is wrong (7 existed, 0 added). Orchestrator may want to confirm this isn't masking a missing unit-test deliverable before shipping.

## Cross-cutting notes
- No new commits on any branch — all 4 streams honored the "no git commands" instruction (git log head unchanged from pre-dispatch state)
- git status count grew from ~125 to 183; delta accounted for by the 4 streams' additions + ongoing design-revamp session churn in `apps/web/**` and `packages/ui/**` (NOT part of this audit)
- Three streams added workspace deps that require docker rebuild `--renew-anon-volumes` before deploy: Stream 1 (`@careeros/sandbox` → api), Stream 2 (`@careeros/browser-agent` → worker), Stream 4 (`age` system package → api image). The memory rule is live for all three.
- `apps/api/package.json` ALSO shows `+@careeros/email-parsers` which belongs to a different session (used by email-ingest module); orchestrator should NOT attribute that line to Stream 1 when committing
- No em-dash violations in user-facing strings across any of the 4 streams; the single Stream 1 em-dash is in a JSDoc code comment at `assessments.service.ts:1529`
- `SESSION_COORDINATION.md` already contains well-written "Shipped" entries for all 4 streams (lines 65-106); orchestrator can use these as commit message material

## Recommendation to orchestrator
1. **Commit streams 2, 3, 4 as-is** via `git commit --only <path>` for each stream's declared files. Rebuild api + worker containers with `--renew-anon-volumes` after.
2. **Hold stream 1 pending adjudication** of the packages/ai cross-session land. Easiest resolution: add an entry under "Cross-session requests" in SESSION_COORDINATION.md asking session-ai-infra to accept + commit `packages/ai/src/prompts/build-task-generator.ts` and the 1-line `index.ts` register, OR commit stream 1 as-is and append a dated line to the "Shared decisions log" documenting the cross-session land was accepted. Either way, the sandbox + assessments pieces (`packages/sandbox/src/index.ts`, `apps/api/src/modules/assessments/*`, `packages/shared/src/schemas/index.ts`, `apps/api/package.json @careeros/sandbox line only`) can commit now; the two packages/ai files are the only ones that need resolution.
3. **When committing stream 1's apps/api/package.json**, use `git add -p` (or edit the staged hunk) so only the `+@careeros/sandbox` line goes in — the `+@careeros/email-parsers` line belongs to a different session and would be mis-attributed if included in a Stream 1 commit.
4. **For stream 4**, note in the commit body or follow-up that the agent's "18 unit tests" claim was inaccurate (actual = 7 pre-existing + 1 new skip-guard). The integration test is real and well-shaped, but if additional unit coverage was intended, orchestrator may want to re-dispatch for the missing tests. No blocker on the production code itself.
