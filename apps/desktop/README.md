# @careeros/desktop

Minimal Electron scaffold for the Career OS desktop companion agent (D.4, phase 3.5).

The agent runs on the user's own machine so LinkedIn/Indeed browsing and ATS form-fills happen from the user's real logged-in Chrome session and IP, not the VPS.

## What this scaffold ships

- Electron main process with a tray icon + menu (Pair / Pause / Resume / Quit)
- Pairing window: user pastes the 6-digit code from `/settings/devices`
- `keytar` wrapper that stores `{deviceId, jwt, refreshToken}` on the OS keyring
- `socket.io-client` connection to `/agent/ws` with exponential backoff reconnect
- Task runner STUB that validates the task envelope and posts `completed` back
- Kill-switch toggles via shared `@careeros/browser-agent` paused-file (same signal the server-side dispatcher respects)

## Dev loop

Requires Node 20 and `pnpm`. From the repo root:

```bash
pnpm install
pnpm --filter @careeros/desktop build
pnpm --filter @careeros/desktop dev
```

The agent will look for the API at `http://localhost:3000` by default. Override via env:

```bash
CAREEROS_API_URL=http://localhost:3000 \
CAREEROS_WSS_URL=http://localhost:3000 \
CAREEROS_AGENT_VERSION=0.0.1 \
pnpm --filter @careeros/desktop dev
```

### Pair flow (manual smoke)

1. Start the API (`pnpm --filter @careeros/api dev`).
2. Sign in on the web app, go to Settings -> Devices, click **Add device**. Copy the 6-digit code.
3. Launch the agent (`pnpm --filter @careeros/desktop dev`). The tray icon appears; click **Pair device**.
4. Paste the code, hit Pair. The window shows "Paired" and the tray tooltip flips to `WSS: connected`.
5. Push a test task from the API (future: dispatcher UI). The runner logs it and posts a `completed` result.

### Kill switch

Click **Pause** in the tray menu. The agent writes a sentinel file (`AGENT_PAUSED_FILE` env, default `/var/run/careeros/agent.paused`) that both the agent runner and the server-side dispatcher check before every task.

## Tests

```bash
pnpm vitest run apps/desktop
```

Unit coverage:

- `src/keychain.test.ts` - keychain wrapper with injected `KeytarLike` fake.
- `src/wss-client.test.ts` - exponential-backoff math for reconnect.
- `src/updater.test.ts` - SemVer comparison + startUpdater schedule + error path.
- `src/proxy.test.ts` - env parse (uppercase + lowercase + NO_PROXY normalization) + applyProxy override.
- `src/screenshot-cleanup.test.ts` - mtime cutoff + subdir recursion + missing-dir no-op (real tmpdir).
- `src/log-rotation.test.ts` - shouldRotate predicate + rename chain + ring-overflow drop (real tmpdir).

End-to-end Electron tests (Playwright-electron) remain deferred; the signing / notarization harness lands first.

## Packaging (D.6)

```bash
pnpm --filter @careeros/desktop dist:mac    # dmg
pnpm --filter @careeros/desktop dist:win    # nsis installer
pnpm --filter @careeros/desktop dist:linux  # AppImage
```

Config lives in `electron-builder.yml`. CI builds all three on tag push
(`desktop-v*`) via `.github/workflows/desktop-release.yml` and attaches
artifacts to the GitHub Release. Installed clients auto-check for updates
on launch and every 6h via `electron-updater`.

## Ops (D.8)

- **Corporate proxy**: `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` env read on
  startup and applied via `session.defaultSession.setProxy()`. Programmatic
  override: `applyProxy(session, { proxyRules, proxyBypassRules })` (future
  Settings UI hook).
- **Screenshot cleanup**: files under `userData/screenshots/` older than
  30 days are purged on startup + every 24h.
- **Log rotation**: `app.getPath('logs')/agent.log` rotates when it crosses
  10 MB OR when the current log is 14 days old (whichever first). Keeps a
  5-file ring (`.log.1` through `.log.5`).

## Deferred (NOT in this scaffold)

| What | Owner stream | Why not now |
|---|---|---|
| Playwright invocation inside the task runner | task-runner integration | Needs @careeros/browser-agent script registry wire + MinIO upload path |
| macOS notarization, Windows code-signing | post-phase upgrade | Non-goal per phase-3.5; needs paid certs (APPLE_ID / CSC_LINK secrets) |
| Auto-start on boot (login item / Startup folder) | D.8 follow-up | Needs OS-specific plumbing per platform; not spec'd in D.8 scope |
| Settings UI for proxy override | apps/web stream | Programmatic setter wired; UI lives in the web app |
| JWT auto-refresh on WSS 401 (today: reconnect-until-success + user re-pair) | task-runner integration | Needs `/agent/pair/refresh` wire + rotation drill |
| Real tray + installer icon assets (today: 1x1 tray + solid-color 512x512 installer PNG) | brand assets drop | Design assets land when the brand folder is adopted |
| ed25519 device keypair (today: random 32-byte publicKey) | D.7 JWT rotation | Server already accepts the current blob shape |

Every deferred piece has a `ponytail:` comment in-source naming its upgrade path.

## Dep notes

- `electron` - runtime; dev dep (packaged runtime ships with the installer later).
- `socket.io-client` - matches `AgentGateway` on the API (socket.io, not plain ws).
- `keytar` - native OS keyring binding; required for off-disk secret storage.
- `electron-updater` - installed for the type surface; wire is deferred to D.6.
- No new root-level deps.
