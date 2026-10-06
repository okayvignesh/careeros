---
commit: ca74dc5
generated: 2026-10-04
scope: test stack, layout, mocking and CI gates
---

# Testing Patterns

Career OS uses a four-layer testing approach — Vitest unit, Testcontainers integration, Playwright e2e/a11y/visual, and a custom LLM-eval runner — plus contract, sandbox-security, and backup-restore side-cars. The stated philosophy is behavior coverage, not a coverage percentage (`plan/testing.md` §10).

## Core Sections (Required)

### 1) Test Stack and Commands

- **Primary test framework:** Vitest 5.0.1 (`vitest.config.ts`, root `package.json`).
- **Integration:** Testcontainers 10.28 (`packages/testing/src/index.ts` spins real Postgres/Redis/Qdrant/MinIO) + `msw` 2.15 for external HTTP in unit tests + `fast-check` 4.10 for property tests.
- **E2E/a11y/visual:** Playwright ^1.48 (resolved 1.63) + `@axe-core/playwright` 4.10 (`apps/web/playwright.config.ts`).
- **Commands:**

```bash
pnpm test                 # vitest run (unit + integration)
pnpm test:unit            # excludes *.integration.test.ts and *.e2e.test.ts
pnpm test:integration     # vitest run integration.test
pnpm test:e2e             # @careeros/web Playwright (headless)
pnpm test:e2e            # via apps/web: pnpm test:e2e:ui for UI mode
pnpm test:a11y            # A11Y=1 pnpm --filter @careeros/web test:e2e
pnpm test:evals           # @careeros/ai evals (EVAL_MOCK=1 default); real run needs provider key
```

### 2) Test Layout

- **Placement pattern:** unit tests are **co-located** next to source (`apps/api/src/modules/skills/skills.service.test.ts`); integration tests are `*.integration.test.ts`; e2e specs live in `apps/web/e2e/`; LLM evals live in `packages/ai/src/evals/<prompt>/`; contract tests are `*.contract.test.ts` in `packages/job-pipeline/src/adapters/`.
- **Naming convention:** `foo.ts` + `foo.test.ts`; integration `foo.integration.test.ts`; e2e `*.spec.ts`; evals `*.eval.ts`; contracts `*.contract.test.ts`.
- **Setup files:** root `vitest.setup.ts` seeds `ENCRYPTION_KEY` (64 hex), `DATABASE_URL`, `REDIS_URL`, `QDRANT_URL`; included via `vitest.config.ts` `setupFiles`. Playwright config lives only at `apps/web/playwright.config.ts`.
- **Counts in the tree:** 273 unit `*.test.ts(x)` (excluding integration + contract), 8 `*.integration.test.ts`, 14 `*.contract.test.ts`, 5 `*.spec.ts` (e2e), 2 `*.eval.ts` (tracked sources via `git ls-files`). The prior cleanup's central gate recorded 1609+ Vitest tests passing / 0 failed with web lint clean (`plan/CLEANUP_TASKS.md` progress log); Waves A–C added the unit suites for the provider fallback, embeddings seam, tokenizer, injection log, master-key rotation, mobile, and market-demand/search-providers. `feat/remaining-work` added co-located suites for Gmail outbound/auth, Slack commands/events/interactive, outreach (unit + integration), external embeddings/config/qdrant, repository analysis, active sessions, verbal assessment (service + grader), browser-agent apply flows/allowlist/form-fill, and the new web libs/panels (Dialog, SecurityPanel, EmbeddingsPanel, RepositoryAnalysisView, verbal components).

### 3) Test Scope Matrix

| Scope | Covered? | Typical target | Notes |
|-------|----------|----------------|-------|
| Unit | Yes | Services, parsers, aggregators, crypto, schemas, priority/XP math | Vitest; colocated; `pnpm test:unit` |
| Integration | Yes (partial) | Prisma queries, encrypted-field opacity, append-only audit, storage, job ingestion, approvals, skill-state sync, outreach approval→draft→send | Testcontainers gated behind `TESTCONTAINERS_E2E=1` + `isDockerAvailable`; 8 files today |
| E2E | Yes (partial) | Setup wizard, post-setup widgets, connect-repo golden flow, security headers | `pr.yml` runs `pre-setup` on a fresh DB and mints an `E2E_STORAGE_STATE` for `post-setup`, plus the header-only `security-headers.spec.ts`; `golden-connect-repo` still skips (needs `E2E_STUB_MODE=1` + server-side stubs) |
| LLM evals | Yes (partial) | skill-extract, knowledge-grader, question-generator, fact-check, email-classifier | `EVAL_MOCK=1` by default; nightly workflow exists but runner registration is deferred |
| Contract | Yes | 12 job adapters (`ashby`, `greenhouse`, `adzuna` MSW, `arbeitnow`, `remotive`, `firecrawl`, `workday`, `lever`, `smartrecruiters`, `workable`, `icims`, `successfactors`) + 2 ATS-submit adapters | 14 files; weekly live revalidation via `adapter-contract.yml` |
| Sandbox security | Yes | Memory/network/fork/wallclock/fs limits | Real Docker (`packages/sandbox/src/security.test.ts`) |
| Backup/restore | Partial | Weekly restore round-trip | Workflow exists (`.github/workflows/restore-test.yml`); round-trip body gated on seed/manifest wiring |
| A11y | Yes | Dashboard, skills, evidence, facts, arena, settings | axe WCAG 2.1 AA; color-contrast disabled in the post-setup spec |
| Visual regression | No `[TODO]` | Per-screen baselines | Declared in spec; `apps/web/e2e/visual/` not present |

### 4) Mocking and Isolation Strategy

- **Main approach:** real services via Testcontainers for integration; `msw` handlers (`defaultHandlers` for GitHub/GitLab/DeepSeek/OpenAI/Anthropic/OpenRouter) for unit external HTTP; Playwright `page.route()` stubs for e2e provider/GitHub responses.
- **Isolation:** `resetDb` helper, per-test transactional patterns planned; e2e uses storage-state auth (`seedStorageState`) so users sign in once; `startInfra` per test file or `beforeAll`.
- **LLM determinism:** evals run `temperature=0`; assertions are schema/property/grounding/pass-rate, never exact strings; responses cached by prompt hash (planned).
- **Common failure mode:** integration suites silently skip when Docker is unavailable (guarded by `TESTCONTAINERS_E2E`), so CI must set the flag — `pr.yml` runs a dedicated `test-integration` job.

### 5) Coverage and Quality Signals

- **Coverage tool + threshold:** none. **No coverage percentage target** (`plan/testing.md` §10). Behavior coverage is the bar: each phase checkbox needs at least one verifying test.
- **Current reported coverage:** `[TODO]` not measured/committed.
- **Quality gates in CI:** `pr.yml` has dedicated jobs for **lint** (`apps/web` eslint 9 is the real gate; `@careeros/api` is excluded because it has no flat config), typecheck (`pnpm -r typecheck` after an explicit `prisma generate`), unit tests, integration tests (Testcontainers, `TESTCONTAINERS_E2E=1`), and **Playwright** (pre-setup on a fresh migrated DB, then `pnpm seed:test` + minted storage state for the authenticated suite). Plus `pnpm audit --prod --audit-level=high`, image-pin check, prompt-version check, Trivy, CodeQL, gitleaks, adapter contracts (weekly), evals (nightly), restore test (weekly).
- **Known gaps/flaky areas:** `golden-connect-repo` e2e self-skips without stub mode + server-side stubs; the new `backlog-routes.spec.ts` self-skips without `E2E_STORAGE_STATE`; `@careeros/api` still has no working eslint flat config (its `lint` script is excluded from CI); only 8 integration files; no visual baselines; the live Docker egress smoke (`scripts/smoke/egress.sh`) is not in CI and remains unrun; `apps/mobile` ships no tests yet. The embedder is real (`bge-small-en` with deterministic fallback, or a configured OpenAI-compatible endpoint), and T29 is resolved — `useApi` (`apps/web/src/lib/use-api.ts`) backs the panels and `react-hooks/set-state-in-effect` is back to `error`.

### 6) Evidence

- `vitest.config.ts`, `vitest.setup.ts`, `apps/web/playwright.config.ts`, `apps/web/e2e/*.spec.ts` (incl. `security-headers.spec.ts`)
- `packages/testing/src/index.ts` (Testcontainers, MSW handlers, axe, arbitraries, migration-safety)
- `.github/workflows/pr.yml`, `nightly-evals.yml`, `adapter-contract.yml`, `restore-test.yml`
- `packages/job-pipeline/src/adapters/**/*.contract.test.ts`, `apps/api/src/**/*.integration.test.ts`
- `apps/web/src/lib/use-api.ts` + migrated panels, `apps/web/src/lib/security-headers.test.ts`, `apps/web/e2e/backlog-routes.spec.ts`, `apps/api/src/modules/outreach/outreach.integration.test.ts`, `apps/api/src/modules/assessments/assessments.service.verbal.test.ts`
- `plan/testing.md`, `CONTRIBUTING.md` §Testing conventions, `plan/CLEANUP_TASKS.md` (verified gate counts)
- `docs/codebase/.codebase-scan.txt` (CI/CD PIPELINES, GIT RECENT COMMITS)

## Extended Sections

### CI pipeline (from `.github/workflows/`)

| Workflow | Trigger | Gates |
|----------|---------|-------|
| `pr.yml` | PR + push main/master | lint (`@careeros/web` only), vitest, `pnpm -r typecheck` (after explicit `prisma generate`), `pnpm audit`, Testcontainers integration, **Playwright e2e (pre-setup + seeded post-setup + axe + security-headers)**, image pins, prompt versions |
| `trivy.yml` | PR + push + Mon 06:00 | HIGH/CRITICAL image CVEs → SARIF |
| `codeql.yml` | PR + push + Mon 05:00 | JS/TS security-extended SAST |
| `gitleaks.yml` | PR + push + Mon 07:00 | secret scanning |
| `nightly-evals.yml` | daily 02:00 | LLM eval suite; drift issue on >5% regression |
| `adapter-contract.yml` | Mon 06:00 + dispatch | live adapter contract revalidation |
| `restore-test.yml` | Mon 03:00 + dispatch | backup restore parity |
| `tag-release.yml` | `v*` tags | build/push images, cosign sign, Syft SBOM, SHA256SUMS |
| `desktop-release.yml` | `desktop-v*` tags | mac/win/linux installer builds |

### E2E golden-flow coverage by phase (`plan/testing.md` §3)

P0 wizard+sign-in (`pre-setup.spec.ts`), P1 connect-repo (`golden-connect-repo.spec.ts`), the wider post-setup widget/a11y spec (`post-setup.spec.ts`), a header-only `security-headers.spec.ts` (security spec item 2), and the `feat/remaining-work` `backlog-routes.spec.ts` (nav wiring + new authenticated screens, self-skipping without `E2E_STORAGE_STATE`). P2-P6 golden flows are otherwise specified but not yet present — the rest are `[TODO]`.
