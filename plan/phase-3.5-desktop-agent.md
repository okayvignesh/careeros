# Phase 3.5 — Desktop companion agent

**Status:** Not started
**Blueprint refs:** §10.5 (application automation), §16 (security). Agent itself is a plan extension.
**Screens in scope:** new — download page + "Devices" settings panel + pairing dialog. Not part of the 59-screen export.

## Goal
Ship a small Electron app the user installs on their laptop. It pairs to the VPS via a device code, holds long-lived credentials in the OS keychain, receives tasks over WSS, and drives Playwright against the user's real logged-in browser session — so LinkedIn/Indeed browsing and ATS form-filling happen from the user's own machine and IP, not the VPS.

## Definition of done
- User can download an installer (macOS + Windows + Linux) from the web app's `/downloads` page.
- Fresh install → paste device code → agent is connected and status green in tray.
- Agent stores no credentials on disk in plaintext; all secrets in OS keychain via `keytar`.
- Agent honors rate/pacing rules from `packages/browser-agent` (~20–50 job views/day, 3–8s jitter).
- One end-to-end task works: "browse LinkedIn saved jobs → return job cards → land in Postgres as `DISCOVERED`".
- User can revoke any paired device from web UI; that device is disconnected within one WSS ping.
- Auto-update via `electron-updater` pulls latest from GitHub Releases.

## Non-goals for this phase
- macOS notarization + Windows code signing (upgrade path documented, not built).
- Multi-account / team support.
- Application form-filling scripts (that's P6; this phase only ships the platform + one discovery script).

## Locked sub-decisions
- Runtime: **Electron + TS + Node**
- Browser: **user's installed Chrome** via Playwright `channel: "chrome"`; fallback to bundled Chromium only if no Chrome present.
- Distribution: **GitHub Releases** + `electron-updater`
- Auth: device-code pairing → short-lived JWT + rotating refresh token; keychain via `keytar`
- Transport: WSS for tasks, HTTPS for large uploads (screenshots)

## Checklist

### Shared package
- [ ] `packages/browser-agent` — pacing rules, kill-switch, allow-list registry, task schema (Zod). Consumed by agent + used by server for validation.

### Server side (VPS)
- [ ] Migrations: `agent_devices` (id, user_id, name, os, last_seen_at, revoked_at), `agent_tasks` (id, device_id, type, params, status, result, screenshots, created_at)
- [ ] `POST /agent/pair/start` — user-initiated, returns 8-char code (10 min TTL, single use)
- [ ] `POST /agent/pair/complete` — agent posts code, returns `{agent_id, jwt, refresh_token, wss_url}`
- [ ] `POST /agent/token/refresh` — rotates refresh, issues new jwt
- [ ] `POST /agent/revoke/:agent_id` — user-triggered, drops WSS connection
- [ ] WSS endpoint `/agent/ws` — bearer-auth on upgrade, per-device rooms, task push + status pull
- [ ] `POST /agent/tasks/:id/result` — agent uploads results + screenshots to MinIO
- [ ] Task dispatcher — enqueues from market/hunt workers, respects device online status
- [ ] Audit log: every task push + result recorded

### Web UI
- [ ] `/downloads` page — OS detection, direct links to latest GitHub Release assets, install instructions
- [ ] Settings → Devices panel — list paired devices (name, OS, last seen), "Add device" button, "Revoke" button
- [ ] Add device dialog — generates code, shows countdown, auto-closes on pair success

### Agent app (`apps/agent`)
- [ ] Electron scaffold — main + renderer split, TS strict, ESM
- [ ] Tray icon + menu (status dot, pause toggle, last run log, quit)
- [ ] Pairing window (single input, submits code, shows success)
- [ ] `keytar` wrapper — store/get/delete `{agent_id, refresh_token}`
- [ ] `wss-client` — connect, auto-reconnect with backoff, JWT refresh on 401
- [ ] `task-runner` — dispatches by task type to script modules
- [ ] `scripts/linkedin-discover.ts` — first real task: read saved jobs page, extract cards, return
- [ ] Pacing enforcer wraps every Playwright action
- [ ] Kill-switch: pause = drops WSS + marks tasks `held` on reconnect
- [ ] Logging: per-run log file in userData dir, rotated

### Packaging & distribution
- [ ] `electron-builder.yml` — dmg (Mac), nsis (Windows), AppImage (Linux)
- [ ] CI workflow: on tag, build all three, publish to GitHub Release
- [ ] `electron-updater` config → GitHub Releases
- [ ] `/downloads` page fetches latest release metadata via GitHub API

### Security
- [ ] JWT scope: only `agent:*` actions, not full user session
- [ ] Refresh token rotation on every use
- [ ] Rate limit pairing endpoint (5 attempts / hour per IP)
- [ ] Agent version reported on every WSS connect; server can force-upgrade
- [ ] User-facing "what this agent can do" disclosure before pairing

### Testing (see `plan/testing.md`)

**Unit**
- [ ] Pacing enforcer — timing invariants under all scenarios
- [ ] Token rotation — refresh on 401, hard fail on invalid refresh
- [ ] Task schema validation (Zod)
- [ ] Keytar wrapper (mocked OS keychain)
- [ ] WSS client — reconnect with backoff, replay held tasks

**Agent-side (against fixture HTML)**
- [ ] `linkedin-saved-jobs` script against saved-jobs page fixture
- [ ] `linkedin-recommended`, `linkedin-search`, `linkedin-applied`
- [ ] `indeed-search`, `indeed-saved`, `indeed-applied`
- [ ] `naukri-recommended`, `naukri-search`, `naukri-applied`, `naukri-profile-visitors`
- [ ] Selector-health probe against stale fixture → correctly flags

**E2E (headless CI)**
- [ ] Mock WSS server → agent connects → picks up task → runs against fixture HTML → posts result → server logs correct audit row
- [ ] Pairing flow: server generates code → agent submits → JWT issued → connection established
- [ ] Revoke flow: user revokes → WSS drops within one ping

**Manual QA gates (documented in `docs/agent-qa.md`)**
- [ ] Real pair on macOS, Windows, Linux
- [ ] Real Chrome session detection (channel: chrome vs bundled fallback)
- [ ] Auto-update via `electron-updater` against test release channel

### Documentation
- [ ] Install guide per OS (with Gatekeeper / SmartScreen workaround steps for unsigned MVP)
- [ ] "How pairing works" one-pager linked from settings
- [ ] Upgrade-path note: what changes when we sign + notarize

### Update UX + platform integration
- [ ] Update-check via `electron-updater` on launch + every 6h
- [ ] Update-available notification in tray + agent window ("v1.2.3 available — restart to apply")
- [ ] Deferred update option (user-triggered restart)
- [ ] Auto-start on OS boot — off by default, toggle in settings:
  - macOS: `app.setLoginItemSettings`
  - Windows: registry `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
  - Linux: `.desktop` file in `~/.config/autostart`
- [ ] Corporate-proxy config UI: HTTP_PROXY / HTTPS_PROXY / NO_PROXY env-var read + editable in settings
- [ ] Screenshot storage: `userData/screenshots/YYYY-MM/`, auto-cleanup after 30 days (configurable)
- [ ] Log rotation: `userData/logs/agent-YYYY-MM-DD.log`, keep 14 days

## Upgrade path (not in this phase)
- Apple Developer account + notarization → removes Gatekeeper prompt
- Windows EV cert → removes SmartScreen prompt
- Residential-proxy support for VPS-hosted headless fallback (only if a user has no laptop uptime)

## Exit criteria
All boxes ticked, one real discovery task runs end-to-end on each OS, PLAN.md status flipped to **Done**.
