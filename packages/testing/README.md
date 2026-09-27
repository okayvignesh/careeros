# @careeros/testing

Shared test helpers for Career OS. Real infra, not mocks. Every helper is
one small file — pick what you need.

## Install

Workspace package. Add to your app or package `devDependencies`:

```json
"@careeros/testing": "workspace:*"
```

## Helpers

### `startInfra()` — Testcontainers Postgres + Redis + Qdrant + MinIO

For integration tests. Guard with `isDockerAvailable()` so CI without a
daemon (or local machines without Docker) skips cleanly instead of hanging.

```ts
import { describe, beforeAll, afterAll, it } from 'vitest';
import { isDockerAvailable, startInfra, type StartedInfra } from '@careeros/testing';

const runE2E = process.env.TESTCONTAINERS_E2E === '1' && isDockerAvailable();
const maybe = runE2E ? describe : describe.skip;

maybe('sync worker against real postgres', () => {
  let infra: StartedInfra;
  beforeAll(async () => { infra = await startInfra(); }, 120_000);
  afterAll(async () => { await infra?.cleanup(); }, 120_000);
  it('runs a migration', async () => { /* ... */ });
});
```

### `createMswServer(handlers)` + `defaultHandlers`

For unit tests hitting external HTTP. Overrides per case:

```ts
import { createMswServer, defaultHandlers } from '@careeros/testing';
import { http, HttpResponse } from 'msw';

const server = createMswServer([
  ...defaultHandlers,
  http.get('https://api.example.com/x', () => HttpResponse.json({ ok: true })),
]);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

### `seedStorageState(opts)` — Playwright auth reuse

Call once in Playwright `globalSetup`; writes `storageState.json` so per-test
workers reuse the session. See doc comment in `src/playwright-storage-state.ts`.

### `runA11y(page)` — axe-core in Playwright

```ts
import { runA11y } from '@careeros/testing';
const violations = await runA11y(page);
expect(violations).toEqual([]);
```

### `arbitraries` — fast-check arbitraries

Pre-baked: `skill`, `normalizedJob`, `user`, `resumeDoc`. Refine per-test with
`.filter` / `.map`.

### `resetDb(prisma)` — truncate + reset sequences

For integration tests reusing a container across files.

## Running

```bash
pnpm test:unit                            # excludes *.integration.test.ts
TESTCONTAINERS_E2E=1 pnpm test:integration  # spins containers
pnpm test:e2e                             # Playwright
A11Y=1 pnpm test:a11y                     # Playwright with A11Y env
pnpm test:evals                           # LLM evals
```

## Adding a new helper

Match the pattern: one file per helper, exported from `src/index.ts`, doc
comment at top with a copy-pasteable snippet.
