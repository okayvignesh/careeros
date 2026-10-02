---
commit: 47be31a
generated: 2026-10-02
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
- **Counts in the tree:** 192 `*.test.ts(x)`, 4 `*.integration.test.ts`, 3 `*.spec.ts` (e2e), 7 `*.contract.test.ts`, 2 `*.eval.ts` (typed sources via `git ls-files`).

### 3) Test Scope Matrix

| Scope | Covered? | Typical target | Notes |
|-------|----------|----------------|-------|
| Unit | Yes | Services, parsers, aggregators, crypto, schemas, priority/XP math | Vitest; colocated; `pnpm test:unit` |
| Integration | Yes (partial) | Prisma queries, storage, worker jobs | Testcontainers gated behind `TESTCONTAINERS_E2E=1` + `isDockerAvailable`; 4 files today |
| E2E | Yes (partial) | Setup wizard, post-setup widgets, connect-repo golden flow | `pr.yml` runs `pre-setup` on a fresh DB and mints an `E2E_STORAGE_STATE` for `post-setup`; `golden-connect-repo` still skips (needs `E2E_STUB_MODE=1` + server-side stubs) |
| LLM evals | Yes (partial) | skill-extract, knowledge-grader, question-generator, fact-check, email-classifier | `EVAL_MOCK=1` by default; nightly workflow exists but runner registration is deferred |
| Contract | Yes | 5 job adapters (`ashby`, `greenhouse`, `arbeitnow`, `remotive`, `adzuna` MSW) | Weekly live revalidation via `adapter-contract.yml` |
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
- **Quality gates in CI:** lint (`apps/web` eslint 9; `@careeros/api`'s lint script is inactive until it gains a flat config), typecheck, `pnpm audit --prod --audit-level=high`, image-pin check, prompt-version check, unit tests, integration tests, Playwright (pre-setup + post-setup), Trivy, CodeQL, gitleaks, adapter contracts (weekly), evals (nightly), restore test (weekly).
- **Known gaps/flaky areas:** `golden-connect-repo` e2e skips without stub mode + server-side stubs; `@careeros/api` has no working eslint config; only 4 integration files; no visual baselines; embedder is a placeholder so semantic tests assert shape, not quality.

### 6) Evidence

- `vitest.config.ts`, `vitest.setup.ts`, `apps/web/playwright.config.ts`, `apps/web/e2e/*.spec.ts`
- `packages/testing/src/index.ts` (Testcontainers, MSW handlers, axe, arbitraries, migration-safety)
- `.github/workflows/pr.yml`, `nightly-evals.yml`, `adapter-contract.yml`, `restore-test.yml`
- `plan/testing.md`, `CONTRIBUTING.md` §Testing conventions
- `docs/codebase/.codebase-scan.txt` (CI/CD PIPELINES, GIT RECENT COMMITS)

## Extended Sections

### CI pipeline (from `.github/workflows/`)

| Workflow | Trigger | Gates |
|----------|---------|-------|
| `pr.yml` | PR + push main/master | lint (`@careeros/web`), vitest, `pnpm -r typecheck`, `pnpm audit`, Testcontainers integration, Playwright (pre-setup + post-setup), image pins, prompt versions |
| `trivy.yml` | PR + push + Mon 06:00 | HIGH/CRITICAL image CVEs → SARIF |
| `codeql.yml` | PR + push + Mon 05:00 | JS/TS security-extended SAST |
| `gitleaks.yml` | PR + push + Mon 07:00 | secret scanning |
| `nightly-evals.yml` | daily 02:00 | LLM eval suite; drift issue on >5% regression |
| `adapter-contract.yml` | Mon 06:00 + dispatch | live adapter contract revalidation |
| `restore-test.yml` | Mon 03:00 + dispatch | backup restore parity |
| `tag-release.yml` | `v*` tags | build/push images, cosign sign, Syft SBOM, SHA256SUMS |
| `desktop-release.yml` | `desktop-v*` tags | mac/win/linux installer builds |

### E2E golden-flow coverage by phase (`plan/testing.md` §3)

P0 wizard+sign-in (`pre-setup.spec.ts`), P1 connect-repo (`golden-connect-repo.spec.ts`), plus the wider post-setup widget/a11y spec. P2-P6 golden flows are specified but the current e2e tree only contains the three P0/P1 specs — the rest are `[TODO]`.
