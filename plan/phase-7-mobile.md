# Phase 7 — Mobile companion (Expo)

**Status:** Scaffold + read-only surfaces shipped (B1). iOS/Android only; push,
offline, and store distribution deferred.
**Platform (owner decision):** **Expo (React Native), SDK 57**, routed with
`expo-router`. Chosen over a Capacitor wrap and over native rewrites for one
TypeScript codebase, OTA updates, and a credible EAS build/submit path.
**Blueprint refs:** §11 (daily integration), §29.12 (repo layout)
**App:** `apps/mobile` · **README:** `apps/mobile/README.md`

## Goal

A read-only companion so the user can check the daily brief, the job pool, and
the pending-approval queue from a phone, against their self-hosted API, without
the web app. Write actions (approving, applying) deliberately stay on the web
for this phase.

## Auth choice

RN cannot read the web's sealed `HttpOnly` session cookie, so the phone reuses
the **desktop agent's durable device-token model**:

- `agent_devices` row + hashed `agent_sessions` row (no schema change), revocable
  from Settings → Devices on the web.
- `mobile:*` JWT (1h) + rotating refresh token (30d), stored via
  `expo-secure-store` (keychain/keystore), not AsyncStorage.
- A global `MobileAuthMiddleware` verifies the bearer and
  `SessionService.requireUserId` accepts it after the cookie, so the existing
  `/jobs`, `/me/approvals`, `/brief/*` controllers serve the phone unchanged.
- `mobile:*` and `agent:*` scopes cannot be replayed against each other.

Sign-in is email + password (shared Argon2id + exponential lockout) rather than
the desktop device-code handshake: the code flow needs an already-authenticated
web session to mint the code, which is awkward on a phone and would need a new
server token scope for reads. The token *lifecycle* (device row, hashed session,
rotation, revocation) is the one the agent uses.

## Implemented

- [x] `apps/mobile` Expo SDK 57 + expo-router TypeScript app, part of the
      `apps/*` workspace; `typecheck` + `lint` scripts.
- [x] app.json (dark, ios/android), tsconfig, eslint flat config, assets.
- [x] API client (`src/lib/api.ts`) with typed endpoints, `ApiError`, and
      refresh-on-401 (concurrent 401s collapse into one rotation).
- [x] Secure token storage + `AuthProvider` / `useAuth`.
- [x] Sign-in, Today (daily brief), Jobs, Approvals, Settings screens — real API
      calls, explicit loading/empty/error states, no fabricated data.
- [x] Dark-first theme mirroring `packages/ui/src/tokens.css`.
- [x] `apps/mobile/README.md`.
- [x] Server: refresh accepts a refresh token + stored `deviceId` (a live
      access token is optional) so a closed app can still rotate after its 1h
      JWT expires; `mobile.service.test.ts` + `mobile.controller.test.ts`
      (12 tests).

## Deferred

- [ ] Push notifications (`expo-notifications`) — Slack already carries the
      scheduled daily brief; decide what uniquely needs a push first.
- [ ] Offline cache / queue (SQLite or AsyncStorage + NetInfo).
- [ ] Store distribution: EAS build profiles, TestFlight, Play Console,
      signing, `eas.json`, native `ios/` + `android/` (managed workflow today).
- [ ] Write actions: approve/cancel from the phone (requires fresh re-auth UX).
- [ ] Passkey / WebAuthn sign-in on mobile.
- [ ] First-run wizard from the phone.
- [ ] Web target (react-dom + react-native-web not installed).
- [ ] `plan/PLAN.md` status-board row + `docs/codebase/*` sync (orchestrator /
      worker A owns those files to avoid write conflicts).

## Verification

```bash
pnpm --filter @careeros/mobile typecheck   # tsc --noEmit — clean
pnpm --filter @careeros/mobile lint        # eslint . — clean
pnpm --filter @careeros/mobile exec expo config --type public   # resolves SDK 57
vitest run apps/api/src/modules/mobile     # 12 passing
```

`expo start` and Docker were intentionally not run in this session.

## Risks / notes

- The untracked `apps/api/src/modules/mobile/*` module predates this phase file
  and is treated as B1's; it is now covered by tests.
- `apps/api` typecheck currently fails on pre-existing errors in
  `modules/embeddings/embeddings.service.ts` (another in-flight change), not on
  anything under `modules/mobile/`.
- `packages/ui` primitives are DOM/Tailwind-only; only token *values* are
  restated in `src/theme/tokens.ts`. A shared cross-platform token export would
  remove the duplication later.
