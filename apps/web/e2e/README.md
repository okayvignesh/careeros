# E2E tests

Playwright drives the running docker stack. Tests are grouped by concern:

- `pre-setup.spec.ts` — the setup wizard is reachable on a fresh DB and the
  first screens render without JS errors. Runs without auth.
- `post-setup.spec.ts` — dashboard / skills / evidence / facts smoke test.
  Requires a signed-in storage state.

## Running

```bash
# One-off, uses the running docker stack:
pnpm --filter @careeros/web test:e2e

# UI runner:
pnpm --filter @careeros/web test:e2e:ui
```

## Signed-in storage state (for post-setup tests)

Full-wizard e2e needs a DeepSeek stub which we haven't wired yet. Until then,
the post-setup smoke suite reads a stashed session:

```bash
# 1. Complete the wizard manually in your browser (sign in, add provider, etc.)
# 2. Export the session cookie into a Playwright storage state:
npx playwright open --save-storage=.e2e-auth.json http://localhost:3000
# (navigate to /dashboard, then close the window)

# 3. Run the suite pointing at that file:
E2E_STORAGE_STATE=.e2e-auth.json pnpm --filter @careeros/web test:e2e
```

If the storage state is missing, post-setup tests skip themselves and the
suite still passes.
