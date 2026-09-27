# scripts/browser-agent

Playwright-driven job-board scripts run by the Career OS desktop companion
(Electron app in `apps/agent/`, Wave D). Ships the first script family plus
a fixture-based test harness so scripts can be developed without hitting a
live board.

## Why user's real Chrome

LinkedIn (and increasingly Indeed) fingerprint headless Chromium hard: a
freshly-launched bundled browser is blocked or CAPTCHA'd within a few
requests. Every script launches via
`chromium.launchPersistentContext(userDataDir, { channel: 'chrome' })`, which
reuses the operator's installed Chrome profile (cookies, extensions, canvas
fingerprint). Boards see a normal signed-in browser.

## Running locally

```bash
export CAREEROS_USER_DATA_DIR="$HOME/Library/Application Support/Google/Chrome"

# Discover jobs (live)
LIVE=1 node --loader tsx scripts/browser-agent/linkedin-discover.ts \
  --query "backend engineer" --location "Remote" --remote --max 25

# Probe selectors (fixture-mode default; safe in CI)
node --loader tsx scripts/browser-agent/probe-linkedin-selectors.ts

# Probe selectors against live LinkedIn
LIVE=1 node --loader tsx scripts/browser-agent/probe-linkedin-selectors.ts

# Fixture-mode tests (no browser, no env)
pnpm vitest run scripts/browser-agent/
```

## Env vars

| Var | Required? | Default | Meaning |
|---|---|---|---|
| `CAREEROS_USER_DATA_DIR` | live only | none | Path to installed-Chrome profile. |
| `CAREEROS_SCREENSHOT_DIR` | no | `/var/log/careeros/agent-screenshots` | Error screenshots; D.8 cleans up 30d+. |
| `DISCOVER_SEARCH_QUERY` / `--query` | discover | none | Search string. |
| `DISCOVER_LOCATION` / `--location` | discover | none | Location filter. |
| `DISCOVER_REMOTE_ONLY` / `--remote` | no | unset | `1` sets LinkedIn `f_WT=2`. |
| `DISCOVER_MAX_RESULTS` / `--max` | no | 25 | Cap on scraped cards. |
| `LIVE` | probe | unset | `1` = probe live, else probe fixtures. |

## Fixture-generation workflow

When LinkedIn reskins:

1. DevTools -> right-click a job card `<li>` -> Copy -> Copy outerHTML.
2. Save under `__fixtures__/linkedin/<scenario>.html`.
3. Add a case to `linkedin-parse.test.ts` asserting the RawJob shape.
4. Bump `SELECTOR_VERSION` in `lib/linkedin-selectors.ts`.
5. `pnpm vitest run scripts/browser-agent/` -> stays green.

Starter fixtures cover: regular, remote, easy-apply, promoted, expired,
missing-company, unicode, broken-html.

## Selector-drift alerting

`probe-linkedin-selectors.ts` prints `{ healthy, missing, drifted, mode }`
and exits code 2 when `healthy: false`. D.8 wires this as a weekly cron;
non-zero exit pages the operator. Runbook: reproduce locally, update
`lib/linkedin-selectors.ts`, add a fresh fixture, bump `SELECTOR_VERSION`.

## Related work

- D.1 `packages/browser-agent`: RateLimiter, selectorHealth, allowlist,
  task Zod. Stubbed inline here with `TODO(D.1)` markers.
- D.6 `apps/agent` Electron shell wraps these scripts.
- D.8 screenshot cleanup + selector-probe cron.
