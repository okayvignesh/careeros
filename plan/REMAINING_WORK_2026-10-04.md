# Remaining Work - Executing Plan (2026-10-04)

Owner: orchestrator (main session). Base commit: `429c1b9` (master, public, AGPL-3.0-or-later).
This work executes on branch `feat/remaining-work` in the isolated worktree
`careeros-ws` (a linked git worktree) so the primary checkout stays clean.

Source of truth for "what is left": `docs/codebase/CONCERNS.md`, the phase plans,
and the four deep-scan inventories captured 2026-10-04.

## Non-negotiable rules (apply to every workstream)

1. **No shortcuts.** No mocks, no fake fixtures presented as real data, no
   hardcoded/placeholder returns, no "coming soon", no disabled affordances, no
   `TODO` left inside a delivered feature. Every delivered feature must call a
   real API / DB / package.
2. **No stub tests.** Tests must exercise real code paths. If a path needs a DB
   or network, use the repo's existing harness (testcontainers / integration
   setup). If it cannot run locally, it MUST pass in CI.
3. **No git writes.** Do not run `git add/commit/checkout/reset/restore/stash/
   clean/rm/switch/branch`. The orchestrator commits. `git status/diff/log` are OK.
4. **No dependency changes.** Do not run `pnpm install` and do not edit
   `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc`,
   `tsconfig.base`. If a dependency is genuinely required, stop and report it.
5. **Stay in scope.** Only edit paths owned by your workstream. Never delete or
   rewrite another workstream's files. If a change is needed outside your scope,
   report it instead of making it.
6. **Verify for real.** Run the scoped typecheck/lint/test commands listed for
   your workstream and paste the exact commands + results in your report. If
   failures originate in files outside your ownership, report them and move on.
7. **Match existing standards.** Read the neighbouring code first; follow naming,
   layering, error-handling, logging, security, and (for UI) the design system.
8. **CI is the final gate.** GitHub Actions must be green for all changed areas.

## Ownership map (file-level, non-overlapping)

| Workstream | Owns (may edit) | Must not touch |
|---|---|---|
| **WS1 / Web UI** | `apps/web/**` | `apps/api/**`, `apps/worker/**`, `apps/mobile/**`, `apps/desktop/**`, `packages/**` (except a tiny read-only use), `apps/api/prisma/**` |
| **WS2 / Outreach + Slack + Gmail** | `apps/api/src/modules/outreach/**`, `apps/api/src/modules/slack/**`, `apps/api/src/modules/gmail/**`, `apps/worker/src/**`, `packages/messaging/**` | `apps/web/**`, `apps/api/prisma/**`, `packages/embeddings/**`, `packages/browser-agent/**` |
| **WS3 / Embeddings + browser-apply + verbal + passkey-backend** | `packages/embeddings/**`, `packages/browser-agent/**`, `packages/stt/**`, `apps/api/src/modules/embeddings/**`, `apps/api/src/modules/assessments/**`, `apps/api/prisma/**` (schema + migrations) | `apps/web/**`, `apps/worker/src/**` (WS2 owns it), `apps/api/src/modules/{outreach,slack,gmail}/**` |

Shared files: if you must change a shared file (`apps/api/src/app.module.ts`,
`packages/shared/**`, worker registry), **report the exact change** in your final
message and prefer a local alternative. WS3 owns Prisma schema/migrations; WS2
must not change schema.

## Workstream 1 - Web UI backlog (frontend)

Goal: close the web UI gap so every shipped backend capability has a real,
accessible screen, wired via the existing API client. Read `careeros-screens/`,
`docs/codebase/`, `apps/web/src/app/globals.css`, `apps/web/tailwind.config.ts`,
`packages/ui`, `apps/web/src/components/*`, `apps/web/src/lib/api-client.ts`,
`apps/web/src/lib/use-api.ts`, `apps/web/src/lib/setup-nav.ts`, `AppNav.tsx`.

Priority order:
1. Wire orphaned routes into navigation: `/market/skill-demand`,
   `/market/trends`, `/settings/search-providers`.
2. `/settings/security` - passkey registration/list/remove UI (backend already
   ships passkey endpoints; find them in `apps/api/src/modules/auth`), plus
   active-session management if the backend exposes it.
3. `/settings/data` (data & privacy) - export + delete account, honouring the
   approval flow (do not present direct deletion as instant).
4. `/settings/notifications` (58) and `/settings/backup` (63) + storage (57).
5. Inbox triage (50) and daily brief (49) screens.
6. Interview prep (47), outreach composer (48) - consume the routes documented by
   WS2 below.
7. Job match report (37), company dossier (38), repo analysis (19),
   job sources (55), source verification (39), quest detail (29), fact-check
   gate (42).

Requirements: no new deps; use `api-client`/`use-api` and `@careeros/shared`
types; keep the existing visual language (tokens, motion, lucide icons);
keyboard + axe accessibility; add e2e coverage in the existing `apps/web/e2e`
style for the primary flows.

## Workstream 2 - Outreach send + Slack handlers + Gmail drafts

Goal: make the daily-assistant / controlled-execution loop real. Read
`plan/phase-5-daily-assistant.md`, `plan/phase-6-controlled-execution.md`,
`AGENTS.md` (rule 3: every external side-effect goes through approvals) and the
three modules. Requirements:
- **Gmail**: real `drafts.create` + `messages.send` (and reply threading) using
  the existing Gmail client/credentials; MIME-safe; idempotent.
- **Outreach**: compose -> approval -> send -> status lifecycle; the
  `outreach_email` approval kind must actually execute (currently marks failed);
  retries, rate limits, audit events, and reply linking.
- **Slack**: real slash-command handlers (`/jobs`, `/brief`, ...), `events`
  dispatch, and `interactive` action handlers; keep signature verification and
  add rate limiting.
- **Worker**: queues/jobs for the above; no placeholder logs as the happy path.
- Tests: unit + integration for each lifecycle.

## Workstream 3 - External embeddings + browser-apply + verbal assessments

Goal: remove the remaining real stubs. Requirements:
- **External embeddings**: implement an OpenAI-compatible `/embeddings` adapter
  in `packages/embeddings` (use `fetch`; no new deps), construct it in
  `resolveProvider()` from `externalBaseUrl`/`externalApiKey`, validate config,
  handle dimensions/errors/fallback, and test it with a stubbed HTTP server.
- **Browser agent apply scripts**: replace the `selector-broken` stubs with
  real, maintainable apply flows for Greenhouse/Lever/Workday and best-effort
  LinkedIn/Indeed/Naukri. This is the client-side desktop agent, so it is
  allowed (AGENTS.md rule 4 bans *server-side* scraping). Unit-test against
  saved DOM fixtures (no live network in tests). Report capabilities honestly.
- **Verbal assessments**: add the `verbal_sessions` model + migration, service,
  REST endpoints, and whisper grading via `@careeros/stt`. Document the exact
  routes for WS1. Tests for the grading path with a stubbed STT client.
- **Passkey backend**: verify the shipped passkey service/endpoints are complete
  and fix any gaps (UI belongs to WS1; do not touch web).

## Verification protocol (per workstream)

1. Implement fully; keep a running task list.
2. Self-review adversarially: grep your own diff for `TODO|FIXME|stub|mock|
   placeholder|not implemented|coming soon|hardcod`; remove or justify each hit.
3. Run scoped checks (typecheck + lint + tests). Web UI: also `next build` and
   the e2e specs you added. Packages: build + unit tests.
4. Produce a report: files changed, endpoints added (verbatim route + payload),
   tests added + exact commands + observed results, remaining gaps with evidence,
   and anything required outside your ownership.

An independent verification agent reviews each workstream's diff afterwards and
CI (`.github/workflows/pr.yml`) is the final gate.
