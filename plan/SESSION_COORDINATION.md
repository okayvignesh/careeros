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
| `apps/desktop/**` | session-ponytail | H2 D.4 scaffold + I1 D.6/D.8 packaging/ops shipped |
| `.github/workflows/desktop-release.yml` | session-ponytail | I1 D.6 release workflow (tag-triggered) |

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
| G1 apps/api grab-bag (USAGE_STATS + startup-check grid; 3 already-shipped, 1 blocked) | shipped 2cb812c | 37/37; career_goals encryption needs schema (cross-session request filed) |
| G2 ATS-lint per-rule tests | shipped 4fe6c0f | 5/5 new, 28/28 package |
| G3 lefthook + eslint rules + verify-esco (5 new, 3 already-shipped) | shipped 5f6f76d | 0 new deps; root package.json surgically staged |
| H1 no-analytics-in-web guard (direct + transitive via lockfile) | shipped ca93a9c | 3/3; 35-item blocklist; 0 new deps |
| H2 D.4 Electron scaffold minimal (apps/desktop) | shipped f65cd96 | 10/10; builds + typecheck clean; D.6/D.8/task-runner wire still deferred |
| I1 D.6 packaging + D.8 ops (electron-builder + updater + proxy + cleanup + rotation) | shipped 4746494 | 38/38; CI release workflow mac/win/linux matrix; non-goals (notarization + EV cert) ponytail-tagged |

### session-ai-infra

| Stream | Status | Notes |
|---|---|---|
| #11 circuit breaker on LLM provider (>20% error / 5 min) | claimed | packages/ai/src/providers/** + wrap.ts |
| #12 per-call token cap pre-flight (js-tiktoken) | claimed | packages/ai/** |
| #13 nightly eval drift alert | claimed | .github/workflows/nightly-evals.yml + scripts/eval-drift.ts |
| #14 evidence_refs hard Zod constraint | claimed | packages/ai/src/prompts/** |

---

## Shipped this cross-session batch

- **Stream I1: D.6 packaging + D.8 ops (combined, apps/desktop/-scoped)** (session-ponytail, 2026-10-02, not yet committed): closes `plan/phase-3.5-desktop-agent.md:65-68` (D.6) + `:116-118` (D.8) + `plan/DEFERRED.md` P3.5 "D.6 packaging" + "D.8 proxy config + screenshot cleanup + log rotation" lines at MVP level on the H2 scaffold.
  - **D.6 shipped**:
    - `apps/desktop/electron-builder.yml` NEW: dmg (mac) + nsis (win) + AppImage (linux); appId `com.careeros.desktop`; GitHub provider for `electron-updater` wire; `asar: true`. Unsigned MVP per phase-3.5 non-goals; ponytail comments name the APPLE_ID / CSC_LINK upgrade.
    - `apps/desktop/build/icon.png` NEW: 512x512 solid-color RGB placeholder generated via a one-shot Node script (crypto PNG writer, 1.8KB). electron-builder derives Windows `.ico` + macOS `.icns` automatically. Ponytail comment in `build/README.md` names the "replace with real brand assets when the logo folder lands" upgrade path.
    - `apps/desktop/build/README.md` NEW: packaging-resources explainer.
    - `apps/desktop/src/updater.ts` NEW: lazy-requires `electron-updater`, wires `error` / `update-available` / `update-downloaded` handlers, calls `autoUpdater.checkForUpdatesAndNotify()` on start AND on a 6h interval. Pure `isNewerVersion(a, b)` SemVer comparator exported so the test locks the `1.10.0 vs 1.9.0` regression without the updater runtime. Degrades to a no-op when electron-updater is absent (keeps unit tests fast + unblocks dev loops without the native dep).
    - `apps/desktop/package.json`: + `pack`, `dist:mac`, `dist:win`, `dist:linux`, `release` scripts; `electron-updater` moved from devDependencies to dependencies (updater code is RUNTIME, not build-time); `electron-builder ^25.1.8` added to devDependencies.
    - `.github/workflows/desktop-release.yml` NEW: triggered on `desktop-v*` tag push; matrix `[macos-latest, windows-latest, ubuntu-latest]`; pnpm/action-setup@v4 + actions/setup-node@v4 with pnpm cache; builds via `pnpm --filter @careeros/desktop release` which runs electron-builder with `--publish always` + `GH_TOKEN` so artifacts auto-attach to the triggering GitHub Release.
  - **D.8 shipped**:
    - `apps/desktop/src/proxy.ts` NEW: `parseProxyEnv(env)` reads `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` (both uppercase + lowercase, curl-style) and returns Chromium's `{proxyRules, proxyBypassRules}` shape (`http=url;https=url` + comma-joined bypass list). `applyProxy(session, override?, env?)` calls `session.setProxy()` with either the override (future Settings UI hook) or the env-derived config; empty env resets to clear any prior proxy. Ponytail comments name the Settings UI deferral + PAC/WPAD upgrade path.
    - `apps/desktop/src/screenshot-cleanup.ts` NEW: `runCleanupPass({dir, retentionDays=30, now})` recursively walks (`fs.readdir` with `withFileTypes`), compares `fs.stat.mtimeMs` to the cutoff, `fs.unlink`s stale files. Handles missing dir cleanly. `startCleanupScheduler({dir})` runs one pass immediately + re-runs every 24h on `setInterval` (unref'd timer so it doesn't keep the loop alive on quit). YYYY-MM subdirs per phase-3.5 spec recurse automatically.
    - `apps/desktop/src/log-rotation.ts` NEW: pure `shouldRotate(stat, now, maxBytes, retentionDays)` predicate — triggers on size (10MB default) OR age (14d default), whichever first. `runRotationPass({dir, file='agent.log', keep=5})` does the rename chain: unlinks `.log.5`, `.log.4` -> `.log.5`, ..., `.log` -> `.log.1`, then writes an empty new `.log`. `startRotationScheduler` ticks every hour (unref'd). Oldest-dropped signal returned so tests can assert ring overflow.
    - `apps/desktop/src/main.ts`: surgical additive wires inside the existing `whenReady()` handler. Added imports for `session` (from electron), `applyProxy`, `startCleanupScheduler`, `startRotationScheduler`, `startUpdater`. Added inside `whenReady` (after `app.dock?.hide` but BEFORE tray creation): `await applyProxy(session.defaultSession)` (try/catch logs instead of crashing main), `startCleanupScheduler({dir: userData/screenshots})`, `startRotationScheduler({dir: app.getPath('logs')})`, `startUpdater()`. All existing H2 wiring preserved verbatim.
  - **Tests** (4 new files, 28 new cases, 38/38 pass across the whole `apps/desktop` suite including the 10 pre-existing):
    - `src/updater.test.ts` (10 cases): 5 on `isNewerVersion` locking the `1.10.0 > 1.9.0` regression + stable-beats-prerelease + leading-v tolerance + reject-downgrade; 4 on `startUpdater` with an injected fake updater that counts `checkForUpdatesAndNotify` calls (asserts initial check + each tick fires it, verifies all 3 event handlers wired, verifies rejection is swallowed to a warn log instead of crashing main); 1 on no-op degradation when electron-updater is missing.
    - `src/proxy.test.ts` (7 cases): `parseProxyEnv` null on empty / both proxies parse / lowercase curl-style names / NO_PROXY whitespace normalization; `applyProxy` env happy path / override wins over env / empty env resets.
    - `src/screenshot-cleanup.test.ts` (4 cases, real tmpdir with `fs.utimes` to seed mtimes): fresh vs stale split with scanned/deleted/errors tally; YYYY-MM subdir recursion; missing-dir clean no-op; exactly-at-cutoff survives (strict less-than).
    - `src/log-rotation.test.ts` (7 cases, real tmpdir): 4 on `shouldRotate` predicate (no stat / under both / size wins / age wins); 3 on `runRotationPass` (chain shift on size trigger, ring overflow drops the oldest, missing current log is no-op, under-threshold leaves chain untouched).
  - **Deps added (apps/desktop/ ONLY, zero at root)**:
    - `electron-builder ^25.1.8` (devDep) - packaging CLI. Verified NOT already pulled in by electron (electron ships the runtime, electron-builder is a separate CLI).
    - `electron-updater ^6.3.9` moved from devDependencies to dependencies (same version H2 shipped; wire went from unused -> runtime so it must bundle).
    - 133 transitive packages added by electron-builder (dmg-builder, app-builder-lib, 7zip-bin, etc.); no new workspace deps.
  - **Build + typecheck + tests all GREEN**:
    - `pnpm install --filter @careeros/desktop...` - clean (133 new transitive packages, no peer-dep violations).
    - `pnpm --filter @careeros/desktop typecheck` - clean after a one-line Dirent widen in screenshot-cleanup.ts (node@22 types quirk on `fs.readdir(..., {withFileTypes})`).
    - `pnpm --filter @careeros/desktop build` - tsc clean + copy-renderer.mjs. All 11 modules compile to dist/.
    - `pnpm vitest run apps/desktop` - **38/38 pass in 199ms** (10 pre-existing + 28 new).
    - Full packaging run (`pnpm --filter @careeros/desktop dist:mac`) NOT verified in this session (same machine policy as H2 window-open smoke); operator one-liner lives in README.
  - **Scope cuts honoured** (all have inline `ponytail:` comments):
    - Unsigned MVP; no notarization, no code-signing (phase-3.5 non-goal). CI workflow deliberately does NOT reference APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID / CSC_LINK / CSC_KEY_PASSWORD; comment at the top names them for the upgrade.
    - Placeholder icon (solid-color 512x512 PNG, deterministically generated from a Node script); comment names "replace with real brand assets when the logo folder lands".
    - No Settings UI for proxy override (apps/web stream owns the UI); `applyProxy(session, override)` is the programmatic hook a future IPC call wires into.
    - No PAC / WPAD autodiscovery (static URL via `HTTPS_PROXY` covers most corp proxies; comment names the `pac_script` upgrade).
    - No gzip on rotated logs (plain text keeps grep/less working; comment names the upgrade when disk budget bites).
    - Playwright-electron E2E harness still deferred (updater handlers covered via injected fake; comment in README names the "lands with signing" upgrade).
  - **Rules followed**:
    - No em dashes in any added file (two slipped in during drafting, both fixed before shipping: `screenshot-cleanup.ts:13` + `build/README.md:13`; final grep clean).
    - No `git` commands run; orchestrator commits after monitor audit.
    - OFF-LIMITS respected: no `apps/web/**`, no `packages/ui/**`, no `infra/docker/**`, no `prisma/schema.prisma`, no `packages/ai/**`, no `packages/browser-agent/**` (imported as workspace dep only), no touches to any pre-existing `.github/workflows/**` file (new `desktop-release.yml` is this stream's; `nightly-evals.yml` / `codeql.yml` / `trivy.yml` / `gitleaks.yml` / `pr.yml` / `restore-test.yml` / `tag-release.yml` / `test-failure-autofile.yml` / `adapter-contract.yml` all read for pattern only, zero edits).
    - All non-trivial logic has at least one assert test (updater version-compare, proxy env parse, cleanup mtime filter, rotation chain shift + ring overflow).
  - **Files touched**:
    - NEW: `apps/desktop/electron-builder.yml`, `apps/desktop/build/icon.png`, `apps/desktop/build/README.md`, `apps/desktop/src/updater.ts`, `apps/desktop/src/updater.test.ts`, `apps/desktop/src/proxy.ts`, `apps/desktop/src/proxy.test.ts`, `apps/desktop/src/screenshot-cleanup.ts`, `apps/desktop/src/screenshot-cleanup.test.ts`, `apps/desktop/src/log-rotation.ts`, `apps/desktop/src/log-rotation.test.ts`, `.github/workflows/desktop-release.yml`.
    - EDITED (surgical): `apps/desktop/package.json` (+5 scripts, electron-updater dep tier swap, electron-builder devDep), `apps/desktop/src/main.ts` (6 added import lines + 11 added lines inside the existing `whenReady` handler; all H2 wiring preserved), `apps/desktop/README.md` (replaced the "Deferred" table with Packaging + Ops + revised Deferred sections reflecting what shipped vs still-deferred).
  - **Test command for monitor**: `pnpm vitest run apps/desktop` -> 38/38 pass. Also `pnpm --filter @careeros/desktop build` + `pnpm --filter @careeros/desktop typecheck` both clean.

- **Stream H2: D.4 Electron scaffold (MINIMAL)** (session-ponytail, 2026-10-02, not yet committed): closes the `plan/DEFERRED.md` P3.5 line "D.4 Electron scaffold + tray + pairing window + keytar + wss-client + task-runner" at MVP level. The scaffold compiles, the renderer HTML lands in dist, 10/10 unit tests pass. Window-open was not launched (CI env; `pnpm --filter @careeros/desktop dev` is the operator one-liner).
  - **New package**: `apps/desktop/` (chose `apps/*` over `packages/*` because this is an Electron application, mirroring `apps/api` / `apps/web` / `apps/worker`; `pnpm-workspace.yaml` already covers `apps/*` so no workspace edit required).
  - **Files (new)**: `apps/desktop/package.json`, `apps/desktop/tsconfig.json`, `apps/desktop/README.md`, `apps/desktop/src/config.ts`, `apps/desktop/src/keychain.ts`, `apps/desktop/src/api-client.ts`, `apps/desktop/src/wss-client.ts`, `apps/desktop/src/task-runner.ts`, `apps/desktop/src/preload.ts`, `apps/desktop/src/main.ts`, `apps/desktop/src/renderer/pair.ts`, `apps/desktop/renderer/pair.html`, `apps/desktop/scripts/copy-renderer.mjs`, `apps/desktop/src/keychain.test.ts`, `apps/desktop/src/wss-client.test.ts`. No existing files touched (no root `package.json`, no `pnpm-workspace.yaml`, no `turbo.json` edits needed; workspace glob + turbo wildcard pipelines pick the new package up for free).
  - **Deps added (all under `apps/desktop/`, zero at root)**:
    - `electron` ^31.3.1 (dev) - Electron runtime for the main process. Required.
    - `socket.io-client` ^4.7.5 (runtime) - matches the API's `AgentGateway` which is socket.io over `/agent/ws`, NOT plain ws (verified in `apps/api/src/modules/agent/agent.gateway.ts:30-34`).
    - `keytar` ^7.9.0 (runtime) - OS keychain binding for `{deviceId, jwt, refreshToken}`. Native prebuilt binary installs cleanly on this machine; postinstall ran without a C compile.
    - `electron-updater` ^6.3.9 (dev) - installed for the type surface only; wire is deferred to D.6 (packaging). Explicitly noted in README + `ponytail:` comment in `main.ts`.
    - Workspace: `@careeros/browser-agent: workspace:*` for `AgentTask` Zod schema + kill-switch pause/resume helpers.
  - **Deferred (every piece has an inline `ponytail:` comment naming its upgrade path + owner stream)**:
    - Playwright invocation inside `TaskRunner` -> "task-runner integration" (next iteration). Today the runner validates the `AgentTask` envelope, honours `isAgentPaused()`, logs, and POSTs `completed` back.
    - `electron-updater` auto-update wire -> D.6.
    - macOS notarization + Windows code signing -> D.6 (phase-3.5 non-goal).
    - Auto-start on boot (login item) -> D.8.
    - Corp proxy support + screenshot retention cron -> D.8.
    - JWT auto-refresh on WSS 401 (today: reconnect-until-success, user re-pair if refresh also died) -> "task-runner integration".
    - Real tray icon assets (today: empty `NativeImage` with a filesystem fallback to `assets/tray.png` if present) -> D.6.
    - ed25519 device keypair (today: random 32-byte base64 blob accepted by the server's current `<=4096 bytes` publicKey rule) -> D.7.
    - Playwright-electron end-to-end test harness (Spectron deprecated) -> D.6.
  - **Tests (2 new files, 10 cases, all pass)**:
    - `src/keychain.test.ts` - 5 cases on the `Keychain` wrapper with an injected `KeytarLike` fake so the test runs under Linux CI without a native keyring: save/load round-trip, partial-missing returns null, `updateTokens` jwt-only + jwt+refresh, `clear` wipes all three accounts, `clear` idempotent on empty.
    - `src/wss-client.test.ts` - 5 cases on the pure `reconnectDelayMs(attempt, base, max)` fn so the backoff math is locked without a running socket: base at attempt 0, doubling 1..6, 60s cap at attempt 7+, custom base/max, defensive negative-attempt case.
    - Full Electron integration/E2E test is explicitly deferred (noted in-source + README).
  - **Build + typecheck verified locally**:
    - `pnpm install --filter @careeros/desktop...` -> clean install (73 new packages, keytar prebuilt binary, electron postinstall).
    - `pnpm --filter @careeros/desktop build` -> `tsc` clean + `copy-renderer.mjs` copies `renderer/pair.html` to `dist/renderer/pair.html`.
    - `pnpm --filter @careeros/desktop typecheck` -> clean.
    - `pnpm vitest run apps/desktop` -> 10/10 pass, 110ms.
    - Window-open NOT verified (no display + launching Electron inside this session is out of scope); operator loop is `pnpm --filter @careeros/desktop dev`.
  - **Architecture notes (shape for the next iteration)**:
    - Main process (`src/main.ts`) owns the tray + IPC handlers + WSS lifecycle. Preload (`src/preload.ts`) exposes a 3-method `window.careeros` surface: `submitPairingCode(code)`, `getStatus()`, `revoke()`. Renderer (`src/renderer/pair.ts` + `renderer/pair.html`) is one HTML file + one TS file transpiled by tsc; no vite, no React.
    - Kill-switch broadcast uses `@careeros/browser-agent`'s `pauseAgent()`/`resumeAgent()` so the same sentinel file (`AGENT_PAUSED_FILE`, default `/var/run/careeros/agent.paused`) that the server-side dispatcher reads also toggles here. One source of truth per phase-3.5 kill-switch spec.
    - `WssClient` owns reconnect (not socket.io's native `reconnection: true`) so we can refresh the JWT before the next connect once that upgrade lands.
    - `ApiClient` uses Node 20 global `fetch`; no axios dep.
  - **Scope respected**: no `apps/web/**`, no `packages/ui/**`, no `infra/docker/**`, no `prisma/**`, no `packages/ai/**`, no `.github/workflows/**`, no `apps/api/src/modules/{agent,interview-prep,outreach,slack}/**` (read-only probes only), no `packages/browser-agent/**` (imported as workspace dep only), no `plan/_audit_*`. Root `package.json`, `pnpm-workspace.yaml`, `turbo.json` all untouched.
  - **No em dashes** in any added file (verified via grep: `renderer/pair.html` body copy, README, in-source comments and ponytail markers all ASCII; the one `—` originally added to `wss-client.ts` + 6 README bullets were removed before shipping).
  - **No `git` commands** run. Orchestrator commits after monitor audit.
  - **Test command for monitor**: `pnpm vitest run apps/desktop` -> 10/10 pass. Also `pnpm --filter @careeros/desktop build` + `pnpm --filter @careeros/desktop typecheck` both clean.

- **Stream H1: no-analytics-in-web guard test (transitive via lockfile)** (session-ponytail, 2026-10-02, not yet committed): closes the `plan/DEFERRED.md` security.md item 6 "no analytics SDK in web guard test" unticked line, complementing the sibling direct-deps test at `apps/web/src/no-analytics-sdk.test.ts` with a transitive scan the sibling doesn't do.
  - `scripts/__tests__/no-analytics-in-web.test.ts` (new, 3 tests, 0 new deps). Reads `apps/web/package.json` (direct) + parses the `packages:` section of root `pnpm-lock.yaml` (transitive) and asserts no entry matches a 35-item blocklist covering GA/GTM, Segment, Mixpanel, PostHog, Amplitude, Heap, FullStory, Hotjar, Vercel Analytics, Datadog RUM, LogRocket, Intercom, FB/tracking pixels. Blocklist supports exact names + `@scope/*` wildcards. `@sentry/*` DELIBERATELY excluded per task spec (self-hosted error tracking is fine).
  - Lockfile parsed with a 2-regex sweep (quoted entries like `'@scope/pkg@1.2.3':` and unquoted entries like `react-dom@19.3.0:`) — no new yaml dep. Peer-dep suffixes `(react@19.3.0)` stripped from the version string. Three guard tests: (a) matchesBlocklist positive+negative self-check so a disabled blocklist flips the test, (b) parser non-empty sanity (>100 entries) so a silently-empty parse can't make the main assertion vacuous, (c) the real scan which reports `<pkg>@<version> [direct|transitive]` on failure so a dev can go straight to `pnpm why <pkg>`.
  - Failure-path verified by injecting `react` into the blocklist in-place and running: test correctly reports `react@18.3.1 [direct]` + `react@19.3.0 [direct]` and fails. Restored to clean. 3/3 pass against current HEAD.
  - `ponytail:` comment names the extension path: "blocklist additions welcomed; current set covers the common web analytics / session-recording / tag-manager SDKs seen in the wild. Add a package name string + rerun." No config file, no package, no abstraction.
  - **Files touched**: `scripts/__tests__/no-analytics-in-web.test.ts` (new) + this append. Nothing in `apps/web/**` (read-only), nothing in `apps/web/.eslintrc*`, nothing in off-limits paths. Root `vitest.config.ts` already globs `scripts/**/*.test.ts` so the test auto-picks up in CI without any config change.
  - **No em dashes** in any added file. **No new deps** (fs/path from stdlib; lockfile parsed as text).
  - **Test command for monitor**: `pnpm vitest run scripts/__tests__/no-analytics-in-web.test.ts` -> 3/3 pass.

- **Stream G3: repo tooling bundle** (session-ponytail, 2026-10-02, not yet committed): 8 small items from `plan/DEFERRED.md`.
  - **(1) `lefthook.yml`** NEW. 3 parallel pre-commit hooks: `gitleaks protect --staged` (skips if binary absent, CI still gates), `pnpm -w typecheck` scoped to `.ts/.tsx` staged changes, `pnpm -r --parallel --if-present lint`. ponytail comment: three hooks, not thirty; local hook earns its keep only if it beats CI's reject latency. Added `prepare` script in root `package.json` (`command -v lefthook >/dev/null && lefthook install || true`) so `pnpm install` wires hooks when the binary is present and silently no-ops when it isn't. No new npm dep: lefthook is a binary install (`brew install lefthook`).
  - **(2+3+4) Root `.eslintrc.cjs`** NEW. Three cross-cutting rules under one roof: (a) `no-console: ['error', {allow:['warn','error']}]` for prod code, (b) `no-restricted-syntax` blocking raw `.chat(` CallExpressions (CallExpression[callee.property.name='chat']) with error pointing at `chatStructured`, (c) `no-restricted-syntax` blocking `data-testid={expression}` JSXAttributes (string literals only). Overrides allow console in tests/demos/scripts/seed and allow raw `.chat(` inside `packages/ai/**` + tests. Config is dormant until a workspace extends it: `apps/web` + `packages/ui` are off-limits (session-design-revamp) so the file is a reference they can adopt via `extends: ["../../.eslintrc.cjs"]` without a merge. No eslint devDep added: writing a config without the runner is cheap; installing a runner nobody invokes is bloat. Verified: `.chat(` grep across `apps/api/src` + `apps/worker/src` finds zero violations (everything uses `chatStructured`); `console.log` grep finds 2 real hits already allowlisted via overrides (`apps/api/src/seed/esco.ts` and a sandboxed program string in `assessments.service.ts:2698` which is not actual code emitted).
  - **(5) `.vscode/launch.json`** — ALREADY SHIPPED 2026-10-02 per DEFERRED.md P0 line (6 configs: api/worker/web dev servers + current-file vitest + all-vitest + attach-9229). No change needed. Verified file still present.
  - **(6) `.github/workflows/test-failure-autofile.yml`** — ALREADY SHIPPED 2026-10-02 per DEFERRED.md testing.md item 7. Dedupes by title (reopens closed issue + appends comment vs. opening a second). Scoped to `workflow_run.event == schedule` + `conclusion == failure`. No change needed. Verified file still present.
  - **(7) `scripts/verify-esco.ts`** NEW. Connects via `PrismaClient` (reads `DATABASE_URL`), asserts `skill.count() >= 188`, asserts every expected top-level category (derived from `apps/api/src/seed/esco.data.json` so script + seed can't drift: all 11 are `ai-ml, backend, cloud, data, devops, frontend, language, mobile, practice, role, testing`) appears via `findMany({distinct:['category']})`. Script exits 1 on any assertion fail. `--self-check` flag runs 3 stub-prisma assertions (happy / below-floor / missing-cat) without touching the DB; ran GREEN. Root `package.json` script: `verify:esco` → `pnpm --filter @careeros/api exec ts-node --project tsconfig.json --transpile-only ../../scripts/verify-esco.ts` (apps/api already has ts-node + @prisma/client; delegating avoids installing anything new at root).
  - **(8) `pnpm fixtures:record`** — ALREADY SHIPPED 2026-10-01 per DEFERRED.md testing.md item 5. Root `package.json` has `"fixtures:record": "ADAPTER_CONTRACT=1 UPDATE_SNAPSHOTS=1 vitest run contract.test"`. No change needed.
  - **Lint-rule verification**: no `pnpm lint` at root (`turbo run lint` only runs workspaces with `lint` scripts; today that is `apps/api` + `apps/web`). apps/api has `eslint . --ext .ts` but no eslint devDep installed, so running it fails independent of this bundle. apps/web uses `next lint` with its own config (off-limits). The root config activates when a workspace extends it. **Zero existing-code violations found** for the three rules via grep (noted inline above).
  - **No em dashes** in any added file. No new runtime or dev deps added (lefthook is a binary; eslint config file is dormant).
  - **Files touched**: `lefthook.yml` (new), `.eslintrc.cjs` (new), `scripts/verify-esco.ts` (new), root `package.json` (surgical: `prepare` + `verify:esco` lines only). Nothing in off-limits paths.

- **Stream G1: apps/api backend grab-bag** (session-ponytail, 2026-10-02, not yet committed): 5 small items; 2 shipped, 2 already-covered, 1 blocked.
  - **Item 1 (ENCRYPTED_FIELDS career_goals) — BLOCKED on schema (prisma schema.prisma = session-ai-infra lock)**: The three siblings (`Evidence.detail`, `Application.notes`, `OutreachMessage.{body,subject}`) are already in `apps/api/src/prisma/prisma.service.ts::ENCRYPTED_FIELDS` as of commit `07b7032`. `career_goals` can't be added as a top-level map key without a schema migration because every PII-bearing column on `CareerGoal` is typed as a Postgres array or int (`targetRoles String[]`, `locations String[]`, `seniority String[]`, `compMin Int?`, `compMax Int?`). The `encryptField` marker returns a string; writing it into a `_varchar` or `integer` column crashes at the DB layer. ENCRYPTED_FIELDS only supports column-level string/json replacement; element-wise array encryption or array-to-text column conversion both require a prisma migration. Logged as cross-session request below.
  - **Item 2 (pairing 5/hr) — ALREADY SHIPPED**: `apps/api/src/modules/agent/agent.controller.ts:80` has `@Throttle({ default: { limit: 5, ttl: 60 * 60 * 1000 } })` on `POST /agent/pair/complete`, regression test at `agent.controller.test.ts:148` ("pair/complete is 5/hr per IP (spec)"). Confirmed in-tree; DEFERRED.md already ticks this item.
  - **Item 3 (`USAGE_STATS=on` opt-in env stub) — SHIPPED**:
    - `apps/api/src/common/config.ts` (new): `getUsageStatsConfig(env = process.env): UsageStatsConfig` returns `{enabled, rawValue}`. Parses `on` / `off` / unset (default off). Case- and whitespace-insensitive. **Throws** on any other value so a typo (e.g. `USAGE_STATS=true`) is caught at boot rather than silently defaulting to off. NO network side effects; no transport code was added (the stub explicitly rejects transport per task scope).
    - `apps/api/src/startup-check.ts`: calls `getUsageStatsConfig()` right after the strong-key checks so the parse runs during `runStartupChecks()`. Bad values therefore refuse boot alongside missing ENCRYPTION_KEY etc.
    - `apps/api/src/common/config.test.ts` (new): 6 tests cover default-off, `on` parses, `off` parses, case/whitespace tolerance, and the three throw cases (`true`, `1`, `yes`). All pass.
  - **Item 4 (startup-check negative-case tests, full grid) — SHIPPED**:
    - `apps/api/src/startup-check.test.ts`: added a 15-case `runStartupChecks full negative-case grid` block that saves + restores `process.env` around each case and seeds a known-good baseline so every test only toggles one axis. Coverage: ENCRYPTION_KEY (missing + weak + too-short), SESSION_SECRET (missing + weak + too-short), POSTGRES_PASSWORD (missing), MINIO_ROOT_PASSWORD (weak), REDIS_PASSWORD (optional-path weak), DATABASE_URL (missing), REDIS_URL (missing), prod-only TRUSTED_ORIGINS (missing) + sslmode (missing + accepting verify-full), USAGE_STATS (bad value + three accepted shapes), plus a positive baseline. No new assertions were added to startup-check.ts itself; the grid fills gaps against EXISTING assertions per task rule.
  - **Item 5 (`llm_calls` retention 90d configurable) — ALREADY SHIPPED**: `apps/worker/src/llm-calls-retention.worker.ts` exports `retentionDays(env)` defaulting to 90, overridable via `LLM_CALLS_RETENTION_DAYS` env, clamped to 1-3650 (DEFERRED.md ticks this entry; task doc called for 7-365 bounds but the ladder says "already covered" — tightening the clamp would be gold-plating). 6 vitest cases in `apps/worker/src/llm-calls-retention.test.ts` cover default + env override + garbage/out-of-range fallback + the delete-many invocation + handler success + handler failure. Both tests the task asked for (`retentionDays` env read + worker uses configured window) are in place.
  - **Test command**: `pnpm vitest run apps/api/src/startup-check.test.ts apps/api/src/common/config.test.ts apps/worker/src/llm-calls-retention.test.ts` -> 37/37 pass.
  - **No em dashes in user-facing strings added**: new error messages (`USAGE_STATS must be 'on' or 'off'...`) use ASCII hyphens only.
  - **Scope respected**: no `prisma/schema.prisma`, no `packages/ai`, no web, no interview-prep/outreach/slack modules. All edits are in `apps/api/src/{common,startup-check*}` + an append to this file.

- **Stream G2: ATS-lint per-rule tests** (session-ponytail, 2026-10-02, not yet committed): closes `plan/DEFERRED.md` P4 line 139 ("ATS-lint per-rule tests (linter `packages/resume-render/lint.ts`)").
  - `packages/resume-render/src/lint.test.ts` (new, 5 tests, 1 file): one test per ATS-lint rule + a sanity "clean fixture = zero findings" sweep. Rules under test: `consistent-bullet-glyph`, `no-fraction-page-numbers`, `no-zero-width-artifacts`, `no-heading-body-fusion`. Each test runs the real `renderResumePdf(SAMPLE_RESUME)` + unpdf extract through the rule predicate and asserts `[]` on the positive half; the negative half runs the same predicate against crafted text that must trip it, so a disabled rule (always-returns-[]) flips the test immediately.
  - **Finding 1 during probe**: `packages/resume-render/src/lint.ts` does NOT exist (verified via `find` + `grep` across the whole repo). The P4 series shipped the "linter" as inline text-predicate assertions inside `packages/resume-render/src/index.test.ts::describe('renderResumePdf ATS-lint markers')`, not as a standalone module. The DEFERRED entry's module path is stale. Per the stream's "tests only, do not refactor the linter" rule, I did NOT invent a new `lint.ts`; the rule predicates are inlined in the test file with a `ponytail:` comment naming the upgrade path (extract to `lint.ts` when a second caller - the resume studio screen-41 pass/fail panel - needs them server-side).
  - **Finding 2 during probe**: react-pdf's layout engine SCRUBS zero-width characters (ZWSP, BOM, ZWNJ, ZWJ, word-joiner) from the output text stream (verified by rendering a tainted `ResumeDoc` and dumping hex: all five are replaced with `0xff`/space). So the zero-width rule's negative case cannot be driven from a tainted `ResumeDoc` through the PDF path. The test runs the rule predicate on crafted text input directly - this still exercises the predicate on both polarities, which is what "test must fail if the rule were disabled" needs. `ponytail:` comment in the test documents this.
  - **Rules identified from existing `index.test.ts::describe('renderResumePdf ATS-lint markers')`**: 4 rules. The three unpdf round-trip assertions (headings present / bullets present / one page) in the sibling `describe('renderResumePdf unpdf round-trip')` are structural renderer tests, not ATS-lint rules per the phase-4 spec (lines 52-62 of `plan/phase-4-the-hunt.md`), so they stay in `index.test.ts` where they live today - this stream covers only the "ATS-lint markers" block.
  - Test counts: 5/5 new (G2 scope) + 23/23 pre-existing = 28/28 across the whole `packages/resume-render`.
  - No em dashes in the new file (test description text uses `-` instead of `—`; `/` separators left intact in rule names and `N/M` labels where they are part of the regex semantics).
  - Scope respected: nothing outside `packages/resume-render/src/lint.test.ts` touched. No lint source invented, no refactor of existing tests, no new exports from `index.ts`, no changes to the fixture (`SAMPLE_RESUME` reused as-is), no new deps added (all imports already in the package's `dependencies`/`devDependencies`).
  - Test command for monitor: `pnpm vitest run packages/resume-render`.
  - No `git` commands run; orchestrator commits after monitor audit.

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

- **2026-10-02, session-ponytail -> session-ai-infra (prisma schema needed):** security.md item 5 "Full grid of tables in ENCRYPTED_FIELDS" has one unticked entry: `career_goals`. Three of four siblings (`evidence`, `applications`, `outreach_messages`) are already wired in `apps/api/src/prisma/prisma.service.ts::ENCRYPTED_FIELDS`. The `career_goals` row can't be added without a schema change because every PII-bearing column is a Postgres array or int (`targetRoles String[]`, `locations String[]`, `seniority String[]`, `compMin Int?`, `compMax Int?`) and the field-encryption marker is a plain string. Two options when you touch the schema next:
  - **(preferred)** collapse the three arrays into a single `goals Json` column (preserves query shape via the app layer; one line in ENCRYPTED_FIELDS: `CareerGoal: [{ column: 'goals', kind: 'json' }]`).
  - **(alt)** change each array column to `String` holding a joined/stringified blob (uglier at the app layer, three lines in ENCRYPTED_FIELDS).
  No action needed from this session; recorded here so the prisma-touching session picks it up when convenient.

- **2026-10-01, session-ponytail -> session-ai-infra (FYI, no action):** C-P2.4 build-task-generator prompt was initially drafted under `packages/ai/src/prompts/build-task-generator.ts`; during remediation it was moved to `apps/api/src/modules/assessments/prompts/build-task-generator.ts` (single consumer, skips the shared registry). `packages/ai/src/prompts/index.ts` was reverted to HEAD. Nothing dropped in your lap; the shared `@careeros/ai` registry stays unchanged.

---

## Shared decisions log

(empty — append a dated line when both sessions agree on something like "sandbox wire reuses `UserLlmLimit` wrapper" so neither re-litigates it)
