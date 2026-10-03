# @careeros/mobile

Career OS mobile companion — **Expo (React Native) SDK 57** with **expo-router**.
Read-only: daily brief, jobs, approvals, settings. All data is fetched live
from the same NestJS API the web app uses (no fabricated content, no local
fixtures).

Owner decision (phase 7): **Expo**, not Capacitor and not a native rewrite.
Expo gives one TypeScript codebase for iOS + Android, OTA updates, and a
credible path to EAS build/submit later.

## Authentication

React Native cannot read the web app's sealed `HttpOnly` session cookie, so the
phone uses the **same durable token model as the desktop agent**: a per-device
row plus a hashed server-side session row that can be revoked from
Settings → Devices.

1. `POST /mobile/auth/sign-in` verifies email + password with the shared
   Argon2id + exponential-lockout path, registers an `agent_devices` row, and
   mints a `mobile:*` JWT (1h) + rotating refresh token (30d).
2. The pair is stored in the OS keychain via **expo-secure-store** (the mobile
   analogue of the agent's `keytar`), never in AsyncStorage.
3. On any `401`, the client rotates once via `POST /mobile/auth/refresh`
   (concurrent 401s collapse into one rotation) and retries. The refresh route
   is authenticated by the refresh token + stored `deviceId`; a live access
   token is optional, because a closed-then-reopened app has an expired JWT.
4. `POST /mobile/auth/revoke` self-revokes the device; sign-out calls it
   best-effort and clears the keychain.

A global API middleware (`MobileAuthMiddleware`) verifies the `mobile:*` bearer
and `SessionService.requireUserId` accepts it after the cookie, so the existing
`/jobs`, `/me/approvals`, `/brief/*` controllers serve the phone without
duplication. `mobile:*` and `agent:*` scopes cannot be replayed against each
other's routes.

## Screens

| Route | Screen | Source |
|---|---|---|
| `/sign-in` | Email + password sign-in | `POST /mobile/auth/sign-in` |
| `/` | Today — XP, streak, open remediation, recent matches, market pulse | `GET /brief/latest`, `POST /brief/preview` |
| `/jobs` | Job list with match score | `GET /jobs` |
| `/approvals` | Pending approval queue (read-only) | `GET /me/approvals` |
| `/settings` | Account, brief preferences, API, sign out | `GET /mobile/me`, `GET /brief/preferences` |

Every read screen renders explicit loading / empty / error states through
`AsyncView`; errors expose a Retry action. Approvals are intentionally
read-only on the phone — decisions stay on the web app for now.

## Theming

`src/theme/tokens.ts` mirrors the dark-first values in
`packages/ui/src/tokens.css` (surfaces, foreground ramp, indigo accent, status
colors, radii). The UI package's primitives (Tailwind + React DOM + Radix)
cannot be imported into React Native, so only the token values are restated —
there is one place to keep them in step.

## Dev loop

Requires the API running on port 3001.

```bash
pnpm install
pnpm --filter @careeros/mobile start
```

The API base URL defaults to `http://localhost:3001` (iOS simulator) or
`http://10.0.2.2:3001` (Android emulator). On a physical device set your LAN IP:

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.20:3001 pnpm --filter @careeros/mobile start
```

Checks:

```bash
pnpm --filter @careeros/mobile typecheck
pnpm --filter @careeros/mobile lint
```

## Layout

```
src/app/                 # expo-router routes (file-based)
  _layout.tsx            # Stack + AuthProvider + dark StatusBar
  (auth)/sign-in.tsx
  (app)/_layout.tsx      # Tabs + signed-out redirect
  (app)/index.tsx        # Today
  (app)/jobs.tsx
  (app)/approvals.tsx
  (app)/settings.tsx
src/components/ui.tsx    # AppText, Card, Button, TextField, Badge, Screen…
src/components/AsyncView.tsx
src/lib/api.ts           # typed client + refresh-on-401
src/lib/auth.tsx         # AuthProvider / useAuth
src/lib/storage.ts       # expo-secure-store wrapper
src/lib/useAsync.ts      # loading/error/data hook
src/theme/tokens.ts      # packages/ui tokens
```

## Deferred

Push notifications, offline cache, store distribution (EAS build/submit,
TestFlight/Play), passkey sign-in, and any write action (approving, applying).
See `plan/phase-7-mobile.md`.
