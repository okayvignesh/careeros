# Career OS — BA + QA gap audit

Generated 2026-09-26. Scope: not-started phases (P3.5, P5, P6), highest-value parked items in P0-P4, product-completeness gaps beyond the plan.

Sources read: `plan/PLAN.md`, `plan/phase-3.5-desktop-agent.md`, `plan/phase-5-daily-assistant.md`, `plan/phase-6-controlled-execution.md`, `plan/testing.md`, `plan/ai-safety.md`, `plan/observability.md`, `plan/release-process.md`, plus grepped parked items from `plan/phase-0..4-*.md`. Blueprint `.docx` files are binary and were not parsed here; assumed non-contradictory with the plan files. Verify blueprint alignment separately if a criterion below conflicts.

Terminology: **AC** = acceptance criterion (Given/When/Then). **U/I/E/EV** = unit / integration / e2e / eval.

---

## BA acceptance criteria — grouped by phase / feature

### P3.5 — Desktop companion agent

**Feature: Device pairing**
- Given a signed-in user on the web app, when they open Settings > Devices > Add device, then an 8-char code + 10-minute countdown is shown and stored server-side single-use.
- Given a valid unused code within TTL, when the agent submits it via `POST /agent/pair/complete`, then the server returns `{agent_id, jwt, refresh_token, wss_url}`, marks the code consumed, inserts a row in `agent_devices`, and audit-logs the pair.
- Given an expired, unknown, or already-used code, when the agent submits it, then the server returns 400 with a stable error code and no device row is created.
- Given >5 pairing attempts from one IP in 60 min, when a 6th attempt arrives, then it is rejected with 429 and logged.
- Given the pairing dialog is open, when pairing succeeds, then the dialog auto-closes within 2 s and the device appears in the Devices list with OS + last-seen timestamp.

**Feature: Task execution + kill-switch**
- Given a paired agent connected via WSS, when the server enqueues a `linkedin-saved-jobs` task, then the agent runs it within pacing rules (3-8 s jitter between page actions, ≤50 job-views/day per device), posts results + screenshots to `POST /agent/tasks/:id/result`, and one audit row per push + result is written.
- Given the user clicks Pause in the tray, when the toggle flips, then the agent drops the WSS connection within 1 s and any in-flight task is marked `held` server-side on reconnect.
- Given a task result contains ≥1 job card, when it is ingested, then each card lands in `jobs_normalized` tagged `DISCOVERED` (never `VERIFIED`) via `packages/job-pipeline`.
- Given selectors are stale for a script, when the agent runs it against a page whose structure shifted, then the script returns `{status: 'selector_stale', screenshot_id}` and the domain is flagged; no partial data is written.

**Feature: Device revocation + credential rotation**
- Given a paired device, when the user clicks Revoke, then within one WSS ping (≤30 s) the agent's connection is dropped, subsequent JWT calls return 401, and the refresh token is invalidated.
- Given an agent's JWT expires, when it calls a protected endpoint, then it uses `POST /agent/token/refresh` (single-use refresh) and receives a new JWT + rotated refresh token; the old refresh is invalidated.
- Given a revoked device attempts refresh, when it calls `/agent/token/refresh`, then it receives 401 and no rotation happens.

**Feature: Auto-update**
- Given a new GitHub Release is published, when the agent runs its 6-hourly update check, then it downloads the update via `electron-updater`, notifies the user in tray + window, and applies on user-triggered restart.
- Given the update download fails or signature check fails, then the agent stays on the current version and logs the failure with reason.

**Feature: Downloads page**
- Given the user visits `/downloads`, when the page loads, then OS is detected, direct links to the latest Release assets for macOS/Windows/Linux are shown, and Gatekeeper/SmartScreen workaround steps are visible.

---

### P5 — Daily assistant (Slack + Gmail)

**Feature: Daily brief scheduler**
- Given a user with Slack connected and preferred send time 08:00 in IANA tz `Asia/Kolkata`, when the wall clock hits 08:00 IST, then a BullMQ job composes a brief and Slack POST is captured (level delta, top 3 quests, 3-5 new jobs, market pulse, streak).
- Given the user runs `/brief --snooze 3`, when the next 3 scheduled send times occur, then no brief is sent and each skipped date is recorded; the 4th day resumes.
- Given the user changes tz to `America/New_York`, when the change persists, then the next scheduled send fires at 08:00 in the new tz.
- Given the user opts out of Slack channel, when 08:00 arrives, then no Slack POST is made and the web brief is available at `/brief`.

**Feature: Slack slash commands**
- Given a Slack signing secret configured, when a request arrives with valid signature and timestamp within ±5 min, then it is processed; otherwise it is rejected with 401 and logged.
- Given `/approve <id>` targets a pending approval owned by the invoking user, when submitted, then the item transitions `pending → approved`, an audit row is written with actor=user, and Slack sends an ephemeral confirmation.
- Given `/approve <id>` targets an unknown or non-owned approval, then Slack returns an ephemeral error and no state changes.
- Given the same Slack `event_id` arrives twice within 24 h, when processed, then only the first execution runs (idempotency).

**Feature: Gmail push → classification → application link**
- Given Gmail watch is renewed daily, when a Pub/Sub push arrives with a valid bearer token, then `history.list` diff runs from last known `historyId` and each new message is fetched.
- Given a message from `jobs-noreply@linkedin.com`, when parsed, then extracted job cards are fed to `packages/job-pipeline` tagged `email:linkedin` + `DISCOVERED`, and never trigger auto-actions.
- Given a message classified `interview_invite` with fuzzy `(company, role)` match ≥0.85 against an open application, when processed, then the email is auto-linked to that application, the timeline is updated, and confidence + fact-refs are stored.
- Given classifier confidence <0.85, when processed, then the item lands on the inbox-triage screen with the top 3 candidate applications for manual override.
- Given an email flagged `SUSPECTED_INJECTION`, when processed, then no auto-action is taken, the item is flagged in triage, and one audit row is written.

**Feature: Alert-email parser drift**
- Given a LinkedIn/Indeed/Naukri alert email in a previously-unseen HTML layout, when parsed, then the parser flags `unknown_format`, falls back to LLM-assisted extraction, and emits a warning metric.
- Given the parser's fixture set for a platform, when the parser code changes, then CI runs golden evals against ≥10 real emails per platform and blocks merge on regression.

---

### P6 — Controlled execution + hardening

**Feature: Approval queue**
- Given an outbound action of type `submit_application | send_email | post_slack | agent_form_fill`, when it is enqueued, then it lands in `pending` with a diff preview showing the full payload and agent reasoning; the model cannot self-approve.
- Given the user clicks Approve on a pending item, when a fresh-auth check passes (< 5 min for high-risk), then the action executes, state moves `approved → sent` on 2xx or `sent → failed` on 4xx/5xx, and audit rows chain across every transition.
- Given the user clicks Reject, then the item moves to `cancelled` with a stored reason, and no external side-effect happens.
- Given >N (config threshold) items are pending bulk-approve, when the user clicks Approve All, then a re-auth prompt appears; N is enforced server-side.

**Feature: ATS submission (Ashby / Greenhouse)**
- Given an approved submission and a valid ATS token, when it is dispatched, then an idempotency key is attached, the response is parsed, `application_id + confirmation_url` are stored, and application state auto-moves to `applied`.
- Given a 429 or 5xx response, when dispatched, then exponential backoff + jitter retries up to 3 times before failing; per-ATS rate limits from `packages/shared/rate-limits.ts` are honored.
- Given a 4xx (not 429), when dispatched, then it fails hard with the response body captured in audit; no retry.
- Given a duplicate idempotency key, when re-submitted, then the ATS returns the original `application_id` and no duplicate application is created downstream.

**Feature: Playwright form-fill (dry-run then live)**
- Given a domain with an allowlist YAML, when a form-fill is triggered for the first time on that domain, then dry-run mode runs (records steps + screenshots, no submit) and the run is presented for user review before live is unlocked.
- Given a live-mode approval, when executed, then the agent fills fields per selectors, submits, captures success signal, and writes screenshots + result to audit.
- Given selectors fail mid-run, when detected, then a screenshot + pre-filled form data + "open in browser" clipboard-copy is presented and the run is marked `selector_stale`.
- Given the selector-health cron finds ≥1 broken domain, when it completes, then that domain is marked `stale`, auto-apply is disabled for it, and an operator alert is emitted.

**Feature: Data portability (export / delete)**
- Given the user requests `POST /me/export`, when it completes, then a signed encrypted `.zip` in MinIO contains `postgres.sql` (user rows only), `files/`, `config.json`, `manifest.json` (list + SHA-256 per file), and row counts in the manifest match a live `SELECT COUNT(*)` across every user-owned table.
- Given the user requests `POST /me/delete`, when they complete fresh re-auth + type their username, then in one transaction all user rows are deleted, all sessions + agent devices + OAuth tokens are revoked, and a post-delete `SELECT COUNT(*)` returns 0 across every user-owned table.
- Given either op runs, then one audit row with actor + IP + UA + timestamp is written.

**Feature: Backup + restore**
- Given the nightly cron, when it runs, then Postgres `pg_dump` + Qdrant snapshot + MinIO sync land at the configured destination encrypted with `age`; a manifest with sizes + hashes is stored beside them.
- Given the weekly restore-test CI job, when it runs against the latest backup, then fresh Docker volumes boot to `setup_state=complete`, row counts match the snapshot manifest, and restoring with the wrong `age` key fails cleanly.
- Given RPO 24 h / RTO 2 h claim, when a live restore is triggered, then the restore + boot completes within 2 h against a snapshot at most 24 h old (documented + runbook-tested quarterly).

**Feature: Interview prep + talk-track**
- Given an application in `interviewing` state, when the user requests prep, then a topic list is generated from job description + dossier + applied resume variant, each topic linked to ≥1 evidence row from the user's graph.
- Given a talk-track is generated per topic, when the fact-check gate runs, then any unbacked claim drops the sentence and the reason is shown in the audit panel; empty tracks are flagged for user rewrite.

---

### Top parked items in P0-P4

#### P0 parked

**Feature: Per-user LLM cost budget + circuit breaker**
- Given `app_config.llm_budget_monthly_usd = X`, when a call would push month-to-date spend over X, then the call is rejected with 429 + reset date and the UI shows remaining budget.
- Given a provider error rate >20% over a 5-min window, when the next call would dispatch, then the circuit breaker routes to the configured fallback provider and logs `circuit_open{provider}`; falls back to error if none configured.
- Given retention = 90 days on `llm_calls`, when the retention worker runs, then rows older than 90 days are deleted; the count deleted is metric-emitted.

**Feature: VPS nightly backup script**
- Given `scripts/backup.sh` runs via cron, when it completes, then Postgres + MinIO + Qdrant snapshots are written to the configured destination, encrypted, with size + SHA-256 in a sibling manifest.
- Given a backup fails, when the run exits, then GlitchTip receives an error + a metric `backup_failure_total` increments.

**Feature: `console.log` block**
- Given source code in `apps/` or `packages/`, when it contains `console.log|warn|error` outside allow-listed boot fallback files, then ESLint fails the build.

#### P1 parked

**Feature: `learning_priority` formula + prereq graph**
- Given a user with skill states + market signals + prereq edges, when priority is computed, then `learning_priority = market_relevance × role_gap × confidence_adjustment × prereq_weight × interview_importance` returns a finite non-negative number, and top-3 changes reflect market data updates within one nightly cycle.
- Given no market data yet, when priority is computed, then it degrades gracefully (defaults documented) and does not throw.

**Feature: Repo commit ingest (slice 2b)**
- Given a connected GitHub account with ≤MAX_REPOS repos, when the sync runs, then commits by the user (filtered by author email) are ingested, per-file evidence is emitted with tree-sitter language + framework detection, and rate limit stays under 5000/hr with pagination.
- Given a repo tagged employer-confidential, when ingest runs, then no code content is sent to any external LLM.

**Feature: `pg_dump` opacity for encrypted PII**
- Given fields marked encrypted, when `pg_dump` is run and grep'd for known plaintext, then zero matches are found; test asserts this against a known secret.

#### P2 parked

**Feature: Code sandbox (Docker-per-run) — sandbox security gates**
- Given a submitted attempt with a memory bomb, when executed, then the container is OOM-killed within the memory limit and returns `SANDBOX_KILLED{reason: 'memory'}`; no other attempts are affected.
- Given code that attempts `fetch('https://google.com')`, when executed, then the request fails at DNS resolution and the attempt records `network_blocked`.
- Given a fork bomb, then pids-limit kills within 2 s; wall-clock >30 s = SIGKILL; filesystem escape returns EACCES.

**Feature: Question corpus expansion + weekly cron**
- Given ≥2 CorpusAdapters configured, when the weekly cron runs, then each is synced, new questions are deduped by `promptHash` + embedding cosine ≥0.92, and per-adapter counts are metric-emitted.
- Given an adapter's source URL returns non-200, when synced, then the run is skipped with a warning; no partial rows are written.

**Feature: Verbal defense + mock-interview multi-turn**
- Given the user starts a verbal-defense run, when they speak into the mic, then `whisper.cpp` transcribes locally (no external call) and the transcript feeds the grader.
- Given a multi-turn mock interview, when the user answers Q1, then the interviewer agent branches Q2 based on Q1 content within the schema; `maxIterations=6` bounded.

#### P3 parked

**Feature: Cross-source fuzzy dedupe + verification state**
- Given two adapters ingest the same job (different URLs, same title + company + location), when normalize runs, then `content_fingerprint` collides and a single primary is chosen; the secondary is stored with `duplicateOf` FK.
- Given a job resolves to a canonical ATS URL, when verified, then state moves `unverified → verified`; unresolved after N retries → `stale`; 404 → `closed`; only `verified` is eligible for auto-apply.

**Feature: Seniority + comp-band classifier**
- Given a job description, when classified, then seniority ∈ `{intern, junior, mid, senior, staff, principal, manager+}` and comp band is normalized to a currency + `{min, max, period}`; low-confidence classifications are flagged not dropped.
- Given user preferences with a seniority target, when Stage 7 runs, then jobs outside the target ±1 band are rejected with reason `seniority_mismatch`.

**Feature: Weekly cron + "what changed" diff**
- Given a persisted market brief, when the Monday 08:00 (user tz) cron fires, then a fresh brief is generated and a diff-vs-previous section (new rising skills, dropped skills, comp shifts) is rendered.

**Feature: Reject-audit dedicated UI**
- Given jobs rejected across pipeline stages, when the user opens the Rejects tab, then rows are grouped by stage + reason with counts, and clicking a row shows the raw payload + rule that fired.

#### P4 parked

**Feature: DOCX render + additional templates**
- Given a resume variant, when the user clicks Download DOCX, then a `docx`-generated file streams with the same content as PDF (ATS-safe: no images, plain bullets, single column).
- Given ≥2 templates (`ats-first`, `classic`, `modern-minimal`, `dense-tech`), when the user switches template, then re-render preserves fact-refs and audit panel; content unchanged.

**Feature: Resume version diff**
- Given a variant with `parentId` set, when the user opens the Diff view, then bullet-level additions/removals/edits are rendered inline with fact-ref changes highlighted.

**Feature: Company dossier**
- Given a job at company X, when dossier is generated, then tech signals + reviews (AmbitionBox / Comparably / Reddit-Blind aggregate) + interview signals are compiled with source URLs + timestamps and pass the fact-check gate.

**Feature: Application detail view + timeline**
- Given an application, when the user opens the detail page, then a chronological event timeline renders (state changes, artifacts attached, emails linked, audit rows), and each event links to its source.

**Feature: ATS-safe linter for generated resume**
- Given a rendered PDF, when the linter runs, then it asserts: single-column, no images, standard fonts, ≤2-page count for junior/mid, plain-text bullets extract cleanly via `pdf-parse` round-trip.

---

## QA test plans — grouped by phase / feature

### P3.5 — Desktop companion agent

**Feature: Device pairing**
- Unit: code generator produces 8-char base32 with TTL; single-use enforcement (2nd submit fails); rate-limit counter increments per IP; token payload has `scope: 'agent:*'` only.
- Integration (Testcontainers): pair round-trip with real Postgres — insert `agent_devices`, audit row present, `jwt` decodable, refresh token stored hashed.
- E2E (Playwright): user generates code → mock agent submits → dialog auto-closes → device row appears in Settings > Devices.
- Eval: N/A.

**Feature: Task execution + pacing**
- Unit: pacing enforcer — 100 simulated calls stay within jitter window ±10%; per-day cap terminates enqueuer; kill-switch drops in-flight promise.
- Unit: task schema Zod validation — malformed task rejected pre-dispatch.
- Integration: mock WSS server pushes 3 tasks → agent runs against fixture HTML → posts results → audit rows match expected count + shape.
- Contract: `linkedin-saved-jobs` script against pinned fixture HTML for each of 4 layout variants; selector-health probe against a deliberately stale fixture flags correctly.
- E2E (headless CI): pair agent → enqueue discover task → job lands in `jobs_normalized` with `DISCOVERED` state.
- Manual QA gate: real Chrome session detection on macOS/Windows/Linux (documented in `docs/agent-qa.md`).

**Feature: Revocation + token rotation**
- Unit: revocation invalidates refresh token; hard-fail on invalid refresh; JWT-401 → refresh → retry pattern.
- Integration: revoke API → within one WSS ping the connection drops (assert via mock WSS server).
- E2E: revoke from UI → mock agent's next call returns 401.

**Feature: Auto-update**
- Unit: version-comparison logic (semver higher / equal / lower).
- Manual QA gate: staged test release channel → agent updates → restart → new version reported on WSS connect.

---

### P5 — Daily assistant

**Feature: Slack signing + slash commands**
- Unit: signature verification (constant-time compare, replay-protection ±5 min, event_id dedupe).
- Unit: `/approve` handler with owner check → transitions state, writes audit; non-owner → returns error.
- Integration: full Slack event round-trip against a mock Slack server → command → response → audit row.
- E2E: run `/brief` in a mock workspace → Slack POST captured with expected Block Kit structure.

**Feature: Gmail push → classification**
- Unit: `history.list` diff processor with fixture payloads; idempotency dedupe on message-id.
- Unit: email-to-application fuzzy matcher across confidence bands.
- Contract: Gmail API `messages.get` + `history.list` against recorded fixtures.
- Fuzz: LinkedIn/Indeed/Naukri parsers against random HTML — never crash, output Zod-valid.
- Eval: `email-classifier/` — 30+ real-shape emails across all 9 classes; assert correct class and confidence in expected band; nightly drift alert if pass drops >5%.
- Eval: `alert-email-parser-linkedin/` — 10+ real emails; asserted extracted jobs match expected count + `(title, company)` set.
- Integration: Pub/Sub push → history diff → classify → auto-link → application timeline updated.
- Integration (injection): payload email with `IGNORE PREVIOUS INSTRUCTIONS` → classification runs safely, no auto-action, injection log row present.
- E2E: inbox-triage screen → user overrides link → application detail reflects the change; `checkA11y(page)`.

**Feature: Daily brief scheduler**
- Unit: timezone-aware send-time computation (10 tz cases including DST edges).
- Unit: composer produces expected Block Kit given seeded data.
- Integration: seed data → scheduler fires → composer runs → Slack POST captured by mock server.
- E2E: schedule brief → mock Slack receives POST within 5 s.

---

### P6 — Controlled execution

**Feature: Approval queue state machine**
- Unit: every valid + every invalid transition (matrix test) → guards prevent skips.
- Unit: bulk-approve threshold enforcement.
- Integration: enqueue → user approves → ATS API called (mock) → response parsed → application state moves → audit_log chain intact.
- E2E: approval → submit dry-run → dry-run artifacts stored + previewed; `checkA11y(page)` on 45, 46.

**Feature: ATS adapters**
- Unit: response parsing (Ashby + Greenhouse) → `{application_id, confirmation_url, status}`.
- Unit: idempotency key generation is deterministic per (userId, jobId, variantId).
- Contract: recorded fixture per ATS covering happy-path, 429, 5xx, 4xx.
- Eval: N/A (no LLM in submission path).

**Feature: Agent form-fill**
- Unit: selector-health probe with mock allowlist entries → stale-detection.
- Sandbox-adjacent: agent form-fill against a fixture Ashby-like site → happy path + selector-broken fallback both tested.
- E2E: full approval → live-mode submit against fixture domain → confirmation captured.

**Feature: Data portability**
- Integration: seed → export → unzip → row counts + file hashes match manifest; wrong password fails cleanly.
- Integration: seed → delete → `SELECT COUNT(*)` returns 0 across every user-owned table; sessions revoked.
- E2E: user triggers export → download → contents match manifest; user triggers delete → typed confirmation → all data gone.

**Feature: Backup + restore**
- Unit: backup manifest generator — sizes, hashes, timestamps present.
- CI weekly: fresh Docker volumes → restore latest backup → boot API → assert `setup_state=complete` + row counts match snapshot; wrong-key restore fails cleanly; issue auto-filed on failure.

**Feature: Interview prep + talk-track**
- Eval: `interview-prep-planner/` — 10+ (job, dossier, resume) → expected topic coverage ≥80%.
- Eval: `talk-track-generator/` — 15+ (topic, evidence) pairs; grounding: every claim ∈ evidence set; empty tracks rejected.
- Eval: `outreach-composer/` — 15+ examples; fact-check pass rate ≥90%.

**Feature: Audit-log immutability**
- Unit: attempting `UPDATE` / `DELETE` on `audit_log` from app role → permission-denied.
- Integration: append-only invariant verified across 1000 concurrent writes; sequential `id` unbroken.

**Feature: Usage & Costs — advanced**
- Unit: cost projection linear + 7-day-trend math on fixture time-series.
- Unit: anomaly detection thresholds (spike vs 7-day baseline).
- Integration: CSV + JSON export contents match filtered `llm_calls` rows.
- E2E: alert config → threshold breach → mock webhook receives payload.

---

### P0-P4 parked-item test plans (top 3-5 per phase)

**P0 — Per-user cost budget + circuit breaker**
- U: budget-check math (edge: reset boundary at midnight in user tz); circuit-breaker window rollover.
- I: over-budget request → 429 with remaining + reset; circuit trip after 20% error rate → fallback provider used.
- E2E: settings screen sets budget → next call rejected in UI.

**P0 — Backup script**
- U: manifest generator, encrypt/decrypt round-trip with `age`.
- I: run `backup.sh` against Testcontainers Postgres → destination has encrypted file + manifest.
- CI weekly: restore parity (see P6).

**P1 — `learning_priority` formula**
- U (property-based): for any inputs, priority is finite + non-negative; monotonic in `market_relevance`.
- I: pipeline runs on seeded data → top-3 changes when market signal shifts.

**P1 — Commit ingest + tree-sitter**
- U: language-detector per extension; framework-detector per manifest.
- I: sync against a fixture GitHub repo → expected evidence rows for known languages/frameworks; pagination stays under rate limit.

**P1 — `pg_dump` opacity**
- I: seed known secret in encrypted field → `pg_dump | grep secret` returns zero matches.

**P2 — Code sandbox**
- Sandbox suite (real Docker): memory-bomb, network, fork-bomb, wall-clock, fs-escape — each killed/blocked per `testing.md` §3.8.

**P2 — Corpus expansion + cron**
- U: dedupe by `promptHash` + embedding cosine ≥0.92 (fixture pairs).
- I: cron fires → per-adapter metrics increment; failing adapter is isolated.

**P2 — Verbal defense**
- U: `whisper.cpp` transcript fed to grader shape validates.
- E2E: recorded audio fixture → transcript → grade rendered.

**P3 — Cross-source fuzzy dedupe + verification**
- U (property-based): dedupe on any (canonical_url, source_id) collision set returns exactly one primary.
- I: 2 adapters ingest same job → single normalized row + secondary linked via `duplicateOf`.

**P3 — Seniority + comp classifier**
- Eval: `seniority-classifier/` — 30+ JDs across 7 bands; pass ≥0.85 on confusion matrix.
- U: comp band normalizer across 10 currency + period fixtures.

**P3 — Weekly cron + diff**
- I: two consecutive briefs → diff section computed correctly (added / removed / shifted skills).

**P4 — DOCX + templates**
- U: DOCX generator produces valid file (unzip + XML parse) with expected sections.
- Visual regression: baseline per template in light + dark.

**P4 — Version diff**
- U: bullet-diff algorithm against fixture pairs.

**P4 — Company dossier**
- Eval: `dossier-writer/` — 15+ companies; every claim has source URL + timestamp; fact-check pass ≥95%.

**P4 — ATS-safe linter**
- U: linter rules per fixture PDF (bad: multi-column, has image, non-standard font; good: single-column plain).

---

## Product completeness gaps

- **Empty / loading / error states matrix** — every screen needs the trio; only `ThinkingOrb` is speccced. Add a per-screen states audit to each phase's frontend checklist. Owner: **all phases (retrofit sweep at P4 close, enforce for P5/P6)**.
- **Skeleton loading vs. spinner policy** — no rule for when to use skeleton vs. orb; dense tables (Jobs, Applications) need skeleton rows. Owner: **P4 design-system extension**.
- **Global error boundary + friendly 500 page** — Next.js needs `error.tsx` + `global-error.tsx` per route group; missing from checklists. Owner: **P0 (retrofit)**.
- **404 + unauthorized + forbidden pages** — no mention of `not-found.tsx` or a unified 401/403 UX. Owner: **P0**.
- **Offline / network-drop UX** — the desktop agent handles WSS drops but the web app has no offline banner or retry UI for API calls. Owner: **P0 shell + P3.5 device panel**.
- **First-run failure recovery in wizard** — `phase-0-install.md` covers install but not "wizard died at step 4; user restarts — pick up where I left off"; setup state persistence + resume flow needed. Owner: **P0**.
- **Onboarding tour after first sign-in** — no product tour, no help-tooltips inventory; users land on `/dashboard` with no context. Owner: **P1 (dashboard-first) + P0 (help layer)**.
- **In-app help center / tooltip layer** — `?` icon, keyboard `?` opens help palette, contextual docs links. Nothing in plan. Owner: **P4 or P6 hardening**.
- **Accessibility beyond `checkA11y(page)` calls** — no explicit WCAG AA per-screen checklist (contrast, focus order, aria-live for async, prefers-reduced-motion coverage beyond animations, keyboard-only path). `testing.md` mandates axe but per-phase acceptance is missing. Owner: **every phase — add a11y checklist section**.
- **Screen-reader-only labels for icon-only buttons** — Simple Icons + Lucide buttons scattered across the app; audit needed. Owner: **P4 sweep**.
- **Focus management on route change** — SPA route changes must move focus to `<h1>`; not specc'd. Owner: **P0 shell**.
- **Keyboard shortcut discoverability** — `Cmd/Ctrl+Enter` submit is documented in code comments only; add a Shortcuts sheet (`?` or `Cmd+K`). Owner: **P4**.
- **Command palette (`Cmd+K`)** — not in plan; competitive parity for this kind of tool. Optional but flag. Owner: **P4 or defer**.
- **Data export UI beyond `/me/export`** — per-domain quick exports (resume as JSON, applications as CSV) are common; only whole-user export is scoped. Owner: **P4 (applications CSV) + P6 (full)**.
- **Data import + migration from LinkedIn/Indeed CSV** — user comes in with existing history; no import path scoped. Owner: **P1 (evidence import) or P4 (applications import)**.
- **Backup destination decision** — parked as open question in `PLAN.md`; P6 checklist requires an answer but no owner. Owner: **P6 blocking-decision**.
- **Backup encryption key management + rotation UX** — `age` mentioned but no key-storage / rotation / recovery-key UX flow. Owner: **P6**.
- **Restore drill in production, not just CI** — CI restore proves the artifact; a quarterly operator drill (from destination → to prod) is missing. Owner: **P6 runbook**.
- **Monitoring alert delivery** — `observability.md` says alerts are operator-configured externally; but the app has no alert-config UI hooks beyond P6 usage-cost alerts. Health-check alerts, backup-fail alerts, queue-depth alerts need at least a documented recommended set. Owner: **P0 (health) + P6 (aggregate)**.
- **Uptime monitoring self-hosting reco** — `observability.md` says "external responsibility"; ship a `docs/observability/uptime.md` with Kuma compose snippet as reference. Owner: **P6 docs**.
- **Log-shipping quickstart** — `docs/logging.md` referenced but no example for Loki/Vector setup. Owner: **P6 docs**.
- **Release upgrade UX in-app** — `release-process.md` covers CLI upgrade; no in-app "new version available" banner or upgrade-history page. Owner: **P6**.
- **Post-upgrade smoke UX** — after `compose up -d`, an admin panel widget showing "all green post-upgrade" would confirm success visually; nothing scoped. Owner: **P6**.
- **Rate-limit UX for user-triggered heavy ops** — LLM budget errors return 429 but the UI shows a raw error; needs friendly "you've used 87% of today's budget, resets at HH:MM" banner. Owner: **P1 (usage screen) + P6 (surface everywhere)**.
- **LLM cost-cap UX pre-flight** — before an expensive op (resume gen, dossier), show projected cost vs. budget so the user can cancel. Owner: **P4 + P6**.
- **Provider fallback UX** — when the circuit breaker trips, users should see "using fallback provider (Ollama)" — silent fallback is confusing. Owner: **P0 gate + surface in P1 usage screen**.
- **i18n scope decision** — nothing in the plan on locale. Confirm English-only for v1.0; document in `docs/support.md`. If any non-en support (numbers, currency, dates already need locale) is intended, needs a phase. Owner: **P6 explicit decision**.
- **Timezone display consistency** — `AGENTS.md` timezone rules mentioned; ensure every timestamp in the UI uses user tz + is toggle-able to UTC. Owner: **P0 shell + design system**.
- **Currency handling for comp band** — comp is stored as `{min, max, currency, period}` but display + user-preferred-currency conversion is not specc'd. Owner: **P3 + P4**.
- **Docs: install guide** — `phase-0-install.md` lists a `README` checkbox but no user-facing install site / dedicated `docs/install.md` with troubleshooting. Owner: **P0**.
- **Docs: user manual** — no end-user manual scoped; help topics live in code comments. Owner: **P6**.
- **Docs: admin runbook** — backup / restore / rotate keys / rotate OAuth tokens / rescue-mode boot — scattered across phase files, needs a consolidated `docs/runbook.md`. Owner: **P6**.
- **Docs: incident response** — `SECURITY.md` for coordinated disclosure exists; internal `docs/incident-response.md` for operator (data loss, provider outage, agent compromise) is missing. Owner: **P6**.
- **Docs: threat model exposed to operator** — `ai-safety.md` has one; but operator-oriented "what this product does with your data, what it never sends, how to verify" landing page is missing. Owner: **P6 docs**.
- **CHANGELOG for MVP prior to v0.1** — `release-process.md` starts at first tag; the pre-1.0 window still benefits from a rolling changelog for beta testers. Owner: **P6**.
- **Legal**: privacy notice, terms of use, data processing addendum — for self-hosted single-user this is lighter but still needed if OSS-public. Owner: **P6 (pending public-release decision)**.
- **License file + third-party notices** — SBOM covers deps but the repo needs a `LICENSE` (missing from checklists) and `NOTICES` for AGPL/MIT/Apache attributions. Owner: **P0**.
- **Cookie / analytics disclosure** — the product likely uses only functional cookies; state so explicitly on a `/privacy` page. Owner: **P6**.
- **Session management UX** — screen 59 exists for Security but no acceptance criteria for "list active sessions + revoke each"; add explicit AC. Owner: **P6**.
- **Passkey recovery flow** — WebAuthn/passkey MFA is scoped in P0 Item 3 but recovery (lost device) is not; recovery codes UI + storage needed. Owner: **P0 or P6**.
- **Multi-user readiness (schema-ready today, UX not)** — invite flow, per-user data isolation UI, role UI ("admin" mentioned in P3 debt) — not scoped. Owner: **post-v1.0 phase**.
- **Admin role enforcement** — noted in P3 debt: `/admin/*` routes use `requireUserId`; `requireAdmin` guard missing. Owner: **P6 auth-hardening**.
- **CSRF on Slack / Gmail webhooks** — signature verification covers Slack; Gmail Pub/Sub bearer covers Gmail; both are documented but confirm no session-cookie routes on integration endpoints. Owner: **P5**.
- **Rate limits on public webhook endpoints** — Slack + Gmail push endpoints need per-source rate limits to prevent DoS via replay. Owner: **P5**.
- **Notifications system across app** — in-app toast + notification-center for async job completions (resume ready, backup done, agent task done) is patchy; only Slack channel is spec'd end-to-end. Owner: **P5 web-channel**.
- **Quiet hours + do-not-disturb** — mentioned for notifications screen (58) but no acceptance criteria. Owner: **P5**.
- **Feature flags / kill switches per feature** — LLM pause exists; per-feature (agent, briefs, integrations) kill switches for outages missing. Owner: **P6**.
- **Health check for LLM providers surfaces to user** — `/health` includes `ai_default` but no visible "provider degraded" banner. Owner: **P0 shell + P1 usage**.
- **Cost-per-artifact display** — every generated artifact (resume, brief, dossier) should show its LLM cost + tokens; scoped nowhere. Owner: **P4 + P6**.
- **Feedback loop UI (thumbs-up/down)** — ai-safety Item 9 requires thumbs-down feeds eval set; no per-artifact UI scoped consistently. Owner: **P1 first-cut + P4 + P6**.
- **Golden-flow test for the wizard end-to-end** — `phase-0-install.md` lists it but P0 status is "in progress"; verify golden flow before P0 flip to Done. Owner: **P0**.
- **Prisma 6 `$extends` migration** — parked in P1 debt; may block dep bumps. Owner: **P1 tech-debt**.
- **20+ eval fixtures for every critical prompt** — several evals currently have 3-8 fixtures (skill-extract, question-generator); testing spec requires 20+. Owner: **each phase that owns the prompt**.
- **Playwright storage-state fixture for wizard** — parked P1 debt; blocks reliable e2e. Owner: **P1**.
- **Screenshot storage cleanup for agent** — 30-day auto-cleanup scoped; UI to see storage usage + purge is not. Owner: **P3.5 or P6 storage screen 57**.
- **Selector-health probe alerting** — cron exists in P6 checklist but no notification channel wired. Owner: **P6**.
- **API rate limiting on all endpoints, not just pairing** — P0 Item 4 mentions rate limiter; per-route limits per user for expensive endpoints (`/me/export`, `/me/resume-variants/for-job`) are not enumerated. Owner: **P6**.
- **PII redaction in error tracker (GlitchTip)** — `beforeSend` runs `redact.ts`; add a positive test that seeds PII into an error and asserts GlitchTip payload is clean. Owner: **P0**.
- **Time-to-first-value metric on first-run** — no product metric for how long from install to first useful screen. Add as a manual QA gate. Owner: **P0**.
- **Screenshot golden set for design-system regressions** — visual regression is in place per phase but a design-system-level baseline set (buttons, cards, forms) prevents cross-phase drift. Owner: **P0 design system**.
- **Docs for verifying container signatures** — `docs/verify.md` referenced in release process; ensure it lands before v0.1. Owner: **P0 or P6**.
- **Post-mortem template** — no `docs/postmortem-template.md` for when things go wrong. Owner: **P6**.

---

## Notes / caveats

- Blueprint DOCX not parsed (binary). If a blueprint clause contradicts anything above, blueprint wins per the plan's cross-cutting rules.
- Every AC above should map to at least one test per `plan/testing.md`; several parked items (mock-interview multi-turn, code sandbox, DOCX render) have no tests yet — flagged in the QA plan section.
- Product-completeness gaps prioritized by "would a paying user reasonably expect this at v1.0"; nice-to-haves (command palette) are marked defer-able.
