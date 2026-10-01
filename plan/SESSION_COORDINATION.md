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
| `prisma/schema.prisma` | session-ai-infra | Reserved — do not touch until released |
| `packages/ai/**` | session-ai-infra | Streams #11 circuit-breaker + #12 token cap + #14 evidence_refs Zod |
| `.github/workflows/nightly-evals.yml` | session-ai-infra | Stream #13 drift alert |
| `scripts/eval-drift.ts` (new) | session-ai-infra | Stream #13 |
| `apps/api/src/modules/slack/**` | in-flight (unassigned) | Slack module changes present in working tree; do not re-touch until released |
| `apps/api/src/modules/assessments/**` | session-ponytail | C-P2.4 sandbox wire |
| `packages/sandbox/**` | session-ponytail | C-P2.4 |
| `packages/browser-agent/**` + `scripts/*-apply*` | session-ponytail | F.3 form-fill |
| `apps/api/src/modules/ats-submit/**` | session-ponytail | F.2 follow-ups |
| `apps/api/src/modules/approvals/**` (hook only) | session-ponytail | F.2 → F.1 wire |
| `apps/api/src/modules/me/**` | session-ponytail | F.8 follow-ups |
| `packages/testing/**` | session-ponytail | F.8 integration harness + F.2 msw fixtures |

Everything not listed is unclaimed.

---

## In-flight streams

### session-ponytail

| Stream | Status | Notes |
|---|---|---|
| C-P2.4 sandbox consumer wire | written, held pending remediation | Monitor flagged packages/ai scope violation; re-dispatch to move prompt into apps/api/src/modules/assessments/prompts/ |
| F.3 agent form-fill | shipped 9d0f60c | 71/71 tests |
| F.2 follow-ups (multipart + msw + approval wire) | shipped 492f1ff | 51/51 tests |
| F.8 follow-ups (MinIO + age + round-trip) | shipped e71b28c | 18 unit + 1 integration (skipped locally) |

### session-ai-infra

| Stream | Status | Notes |
|---|---|---|
| #11 circuit breaker on LLM provider (>20% error / 5 min) | claimed | packages/ai/src/providers/** + wrap.ts |
| #12 per-call token cap pre-flight (js-tiktoken) | claimed | packages/ai/** |
| #13 nightly eval drift alert | claimed | .github/workflows/nightly-evals.yml + scripts/eval-drift.ts |
| #14 evidence_refs hard Zod constraint | claimed | packages/ai/src/prompts/** |

---

## Shipped this cross-session batch

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

- **C-P2.4 build-code sandbox consumer wire** (session-ponytail, 2026-10-01, not yet committed): resolves the 751307e TODO.
  - `packages/sandbox/src/index.ts`: TODO comment replaced with real consumer pointer.
  - `packages/shared/src/schemas/index.ts`: `+GeneratedBuildTaskSchema` (language | title | description | starter | tests | timeoutMs | difficulty).
  - `packages/ai/src/prompts/build-task-generator.ts`: new prompt (contract: tests emit `PASS <name>` / `FAIL <name>` lines on stdout).
  - `packages/ai/src/prompts/index.ts`: registers the prompt.
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

(empty — add here when you need the other session to do something, release a path, or coordinate a schema change)

---

## Shared decisions log

(empty — append a dated line when both sessions agree on something like "sandbox wire reuses `UserLlmLimit` wrapper" so neither re-litigates it)
