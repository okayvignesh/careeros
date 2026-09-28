# Phase 5 — Daily assistant (Slack + Gmail)

**Status:** Backend groundwork shipped (E.2 + E.4 + E.6 of 9 streams). External blocker: Slack + Gmail OAuth review is calendar-blocking. See `plan/HANDOFF.md`.
- E.2 Slack Events API + Block Kit + slash commands + OAuth + `manifest.yml` + `docs/slack-setup.md` — Shipped: `8ac1e41` → `bd2c82b`, 41 tests
- E.4 Gmail Pub/Sub + JWT verify + history-diff + daily watch renewal cron — Shipped: `9b69468` → `f45a39b`, 23 tests
- E.6 `packages/email-parsers` (LinkedIn + Indeed + Naukri + sender allowlist + 30 fixtures) + `email-ingest` service — Shipped: `e59ef71` → `c9218b6`
- **Deferred:** E.1 install docs polish, E.3 daily-brief composer + BullMQ scheduler, E.5 email classifier + evals, E.7 email→application fuzzy match + inbox-triage screen 50 (WEB), E.8 injection defense on emails (partially covered via E.6 wrapUntrusted), E.9 `packages/messaging` Channel + per-event prefs
- **External blockers:** Slack app OAuth review (`manifest.yml` ready) + Google OAuth verification + Pub/Sub topic creation on your Google Cloud project
**Blueprint refs:** §11 (daily integration), §19.3 (email workflow)
**Screens in scope:** `careeros-screens/phase-5-daily-assistant/` (49, 50, 58)

## Goal
User runs most daily tasks from Slack. Recruiter/interview mail surfaces automatically into the application timeline. Job-alert emails from LinkedIn/Indeed/Naukri feed the same job pipeline. Every outbound Slack action is logged and gated.

## Definition of done
- Morning brief posts to Slack on schedule with real data (level delta, quests, market pulse, new jobs).
- Slack slash commands `/quiz`, `/jobs`, `/approve`, `/review`, `/brief` work end-to-end.
- Gmail push notifications route recruiter mail into the right application via fuzzy match.
- LinkedIn / Indeed / Naukri job-alert emails parsed → normalized jobs fed to `packages/job-pipeline` (marked `DISCOVERED`).
- Gmail watch renewal cron runs (Gmail requires ≤7 days; renew daily).
- All outbound Slack actions log to audit trail with approval trace when required.

## Checklist

### Slack app

#### Setup
- [ ] Slack app manifest (yaml) committed at `apps/api/src/integrations/slack/manifest.yaml`
- [ ] Personal workspace install flow (single-user tool; no marketplace)
- [ ] `docs/slack-setup.md` — step-by-step for operator: create app, install to workspace, paste tokens
- [ ] OAuth token stored encrypted in `provider_configs`

#### Runtime
- [ ] Events API endpoint (HTTP mode) — `POST /integrations/slack/events`
- [ ] URL verification challenge handled
- [ ] Message signing verified via `X-Slack-Signature` (constant-time compare)
- [ ] Replay protection: reject timestamps > 5 min old; dedupe on `event_id`
- [ ] Slash commands: `/quiz [topic]`, `/jobs [n]`, `/approve <id>`, `/review`, `/brief`, `/pause`, `/resume`
- [ ] Block Kit builder via `@slack/block-kit` (or hand-rolled JSON with types)
- [ ] Ephemeral responses for command feedback; posted messages for briefs
- [ ] Interactive buttons trigger `POST /integrations/slack/interactive`

#### Content composer
- [ ] Daily-brief composer pulls: level + XP delta since yesterday, top 3 quests, 3–5 new job matches, market-pulse one-liner (rising skill), streak status
- [ ] Actions row: `Start quest`, `Show jobs`, `Market brief`, `Review progress`
- [ ] Grounded per ai-safety Item 1; short-form so no fact-check gate needed but sources still linked

### Gmail integration

#### Setup
- [ ] Google Cloud project instructions in `docs/gmail-setup.md`:
  - Create GCP project
  - Enable Gmail API + Pub/Sub API
  - Create OAuth client (Desktop / Web app type)
  - Create Pub/Sub topic + push subscription pointing at `POST /integrations/gmail/push`
  - Grant `gmail-api-push@system.gserviceaccount.com` publish on topic
- [ ] OAuth scope: **`gmail.readonly`** (final decision — read messages + metadata, sufficient for classification + alert-email parsing)
- [ ] Verification note: `gmail.readonly` requires Google app verification for public release. **Self-hosted:** operator uses their own OAuth client and their own account (unverified apps allow up to 100 users of the developer's own account). Documented in `docs/gmail-setup.md`.

#### Runtime
- [ ] `POST /integrations/gmail/push` — Pub/Sub push endpoint, verifies bearer token per Google's spec
- [ ] `history.list` diff processor — fetch new messages since last known `historyId`
- [ ] Watch renewal cron (daily via BullMQ scheduler)
- [ ] Idempotency: message-id + user-id dedupe
- [ ] All fetched email content stored encrypted (sensitivity=`personal`), retention 90 days configurable

#### Classifier
- [ ] Classes: `recruiter | interview_invite | assessment | rejection | offer | job_alert_linkedin | job_alert_indeed | job_alert_naukri | other`
- [ ] Two-stage: sender/subject heuristic (fast, high-precision on known senders) → LLM classifier (slower, catches edge cases)
- [ ] Classifier prompt versioned + eval set per class (ai-safety Item 10)
- [ ] Every classification wrapped per ai-safety Item 4; scanned per Item 5

### Job-alert email parsing (LinkedIn / Indeed / Naukri)

- [ ] `packages/email-parsers/linkedin.ts` — extracts job cards from LinkedIn alert HTML
- [ ] `packages/email-parsers/indeed.ts` — Indeed alert HTML
- [ ] `packages/email-parsers/naukri.ts` — Naukri alert HTML + response-tracker mails
- [ ] Each parser: HTML → `RawJob[]` (matches P3 pipeline schema)
- [ ] Parsed jobs feed `packages/job-pipeline` as source `email:linkedin` / `email:indeed` / `email:naukri` — always tagged `DISCOVERED`
- [ ] Sender allowlist per parser (LinkedIn: `jobs-noreply@linkedin.com`, Indeed: `alert@indeed.com`, Naukri: `mailer@naukri.com` — extendable via config)
- [ ] Golden eval set per parser (10+ real emails per platform with expected job extractions) — CI gates changes
- [ ] Robust to layout changes: parsers version-tag their format; unknown format falls back to LLM-assisted extraction with a warning

### Email → application matching

- [ ] Fuzzy match on: `(company_name, role_title)` extracted from email against open applications
- [ ] Confidence score: exact match = 1.0, string similarity ≥ 0.85 = 0.8, single-field match = 0.5
- [ ] Auto-link at ≥ 0.85; otherwise queue for user review on inbox-triage screen
- [ ] Manual override always available
- [ ] Records `email_application_links` — soft link, user can unlink

### Daily brief scheduler

- [ ] BullMQ delayed job per user based on user's timezone + preferred send time
- [ ] Default: 08:00 in user's IANA timezone
- [ ] Reschedule on timezone or preference change
- [ ] Snooze: user can skip for N days via `/brief --snooze N`
- [ ] Opt-out: user setting; falls back to web-only brief

### Delivery abstraction

- [ ] `packages/messaging/` — `Channel` interface (`send({recipient, blocks, plaintext_fallback})`)
- [ ] Slack channel implementation
- [ ] Web channel (in-app notification only)
- [ ] WhatsApp channel — **interface stub only, not implemented** (blueprint §11.4 flags for later; adding hook prevents core refactor)
- [ ] Discord channel — same treatment (interface stub)
- [ ] User channel preferences per event type (daily brief, quest reminders, job matches, application updates)

### Inbox triage

- [ ] `inbox_items` table: `email_id`, `class`, `confidence`, `linked_application_id`, `status (new|linked|dismissed)`, `arrived_at`
- [ ] Auto-link classified mail to application by fuzzy match
- [ ] Manual override UI (screen 50)
- [ ] Bulk actions (mark all as read, dismiss all)

### Frontend

- [ ] 49 Daily brief — web mirror of Slack message; historical briefs list; regenerate button
- [ ] 50 Inbox triage — classified mail table, action column, filter chips (per class, per confidence)
- [ ] 58 Notifications — channel preferences per event type, quiet hours, snooze

### Testing (see `plan/testing.md`)

**Unit**
- [ ] Slack signing verification (constant-time compare, replay-protection with clock skew)
- [ ] Gmail `history.list` diff processor with fixtures
- [ ] Each email parser (LinkedIn / Indeed / Naukri) against fixture set — extracts expected job cards
- [ ] Email-to-application fuzzy match scoring across confidence bands
- [ ] Timezone-aware send-time computation (user_tz → UTC)
- [ ] Daily-brief composer with seeded data → expected Block Kit structure

**Fuzz**
- [ ] Each email parser: random HTML → never crashes, output validates against schema

**Contract tests**
- [ ] Slack Web API + Events API against recorded fixtures
- [ ] Gmail API `history.list`, `messages.get` against recorded fixtures
- [ ] Pub/Sub push envelope validation

**LLM evals**
- [ ] `email-classifier/` — 30+ real-shape emails across all 9 classes; assert correct class + confidence in expected band
- [ ] `alert-email-parser-linkedin/` — 10+ real emails; assert extracted jobs match expected

**Integration (Testcontainers)**
- [ ] Full daily-brief pipeline: seed data → scheduler fires → composer runs → Slack POST captured by mock server
- [ ] Full email pipeline: Pub/Sub push → history diff → classify → link to application
- [ ] Injection-flag test: injection-payload email → classification runs safely, no action taken

**Playwright golden flow**
- [ ] Trigger brief flow, confirm Slack POST fired (against mock server)
- [ ] Inbox triage: classify → manual link override → application timeline updated
- [ ] `checkA11y(page)` on 49, 50, 58

**Visual regression**
- [ ] Baselines for P5 screens

### AI safety — Items 4, 5 (see `plan/ai-safety.md`)

#### Item 4 — Untrusted wrapping (email body + attachments)
- [ ] Every parsed email body wrapped via `wrapUntrusted(content, "email")` before entering classifier or extraction prompt
- [ ] Attachments treated as untrusted; PDFs text-extracted via `pdf-parse` then wrapped
- [ ] HTML sanitized before display (DOMPurify) — no active content ever rendered

#### Item 5 — Injection scan on emails
- [ ] Every incoming email runs `injection-scan` before entering any prompt
- [ ] High-score emails: no auto-action, flagged to user for manual review on triage screen
- [ ] Test: injection-payload email → classification runs safely, no action taken

### Observability additions (see `plan/observability.md`)
- [ ] Metrics: `emails_received_total{class}`, `emails_matched_total{confidence_bucket}`, `alert_emails_parsed_total{platform,result}`, `slack_commands_total{command}`, `daily_briefs_sent_total{result}`
- [ ] Log: every classification with `email_id`, `class`, `confidence`, `linked_app_id`

## Exit criteria
All boxes ticked, blueprint §11 daily flow covered, PLAN.md updated.
