# Phase 6 — Controlled execution + hardening

**Status:** Not started
**Blueprint refs:** §10.5 (application automation), §16 (security), §25 (risks)
**Screens in scope:** `careeros-screens/phase-6-controlled-execution/` (45, 46, 47, 48, 57, 59, 60, 63, 64)

## Goal
Approved actions execute with auditability. ATS APIs used where possible; Playwright only for supported workflows. Backup, recovery, and security posture solid.

## Definition of done
- Approval queue gates every outbound submission and message.
- ATS submission via API succeeds against at least one live target (Ashby or Greenhouse).
- Playwright automation runs only on allow-listed sites with visible dry-run mode.
- Full audit log per submission (payload, response, screenshots).
- Backups run nightly, restore tested end-to-end.
- Recovery-key rotation supported.

## Checklist

### Approval queue
- [ ] Queue schema (`pending`, `approved`, `sent`, `failed`, `cancelled`)
- [ ] Diff preview per item (what will be sent)
- [ ] Bulk-approve gated by threshold

### ATS submission adapters
- [ ] Ashby application submit
- [ ] Greenhouse application submit (where allowed)
- [ ] Idempotency keys per submission
- [ ] Per-ATS rate limits declared in `packages/shared/rate-limits.ts`; queue-level throttling
- [ ] Exponential backoff on 5xx / 429; hard fail on 4xx (see AGENTS.md §Retry & backoff)
- [ ] Response parsing: extract confirmation URL, application_id, status; write to audit log
- [ ] Auto-move application state on success (`applied` per P4 state machine)

### Playwright automation (runs in desktop agent from P3.5, not on VPS)
- [ ] Allow-list registry YAML at `packages/browser-agent/allowlist/*.yaml` — one file per domain, shared server + agent
- [ ] Each YAML declares: domain, selectors per field type, submit selector, success signal, per-domain pacing overrides
- [ ] Dry-run mode (records steps + screenshots, no submit) — default first time per domain
- [ ] Live mode gated by explicit user approval per run
- [ ] Agent-side script bundle: `ashby-apply`, `greenhouse-apply`, `linkedin-easy-apply`, `indeed-easy-apply`, `naukri-apply`, `generic-form-fill`
- [ ] Fallback when selectors break: capture screenshot + pre-filled form data → punt to user with "open in browser to complete" + clipboard-copy button
- [ ] Selector-health probe per allowlist entry (weekly cron) — mark domains as `stale` when selectors fail; disables auto-apply on that domain
- [ ] Server-side: task push over WSS + audit-log ingest of screenshots/results
- [ ] Kill-switch honored (agent tray pause = server marks all pending tasks as `held`)

### Interview prep

- [ ] Per-job prep plan generation: topic list (from job description + company dossier), evidence links per topic (from user's graph), mock-interview schedule
- [ ] Topic source strategy — LLM-generated from job description + dossier + user's applied resume variant (grounded, per ai-safety Item 1)
- [ ] Talk-track generator from evidence: per topic, produce a 60–90s verbal-answer draft grounded in user's real experience
- [ ] Fact-check gate applies to talk-tracks (Item 6)
- [ ] Practice session reuses P2's verbal-defense runner (whisper.cpp local transcription)
- [ ] Feedback: transcript + LLM eval scoring content + delivery signals (pauses, hedging)

### Outreach composer
- [ ] Template library: `cold-reach`, `warm-referral`, `event-followup`, `alumni-connection`, `application-followup` — versioned
- [ ] Per-industry variants (`startup`, `enterprise`, `academia`)
- [ ] Per-recipient personalization from company + role signals (grounded, Item 1 + fact-check Item 6)
- [ ] Send-timing rules: business hours (09:00–17:00) in recipient's timezone (inferred from company HQ or explicit override)
- [ ] Never batch-send; each message individually approvable
- [ ] Send via Gmail draft (never direct-send without approval) — user reviews in Gmail then hits send
- [ ] After-send tracking: watch inbox for replies, link to `outreach_messages` row

### Security & privacy
- [ ] Sensitivity-label enforcement in prompt pipeline (already in ai-safety Item 8; re-verify at phase gate)
- [ ] Secret redaction pass before embedding (already in P0 via `packages/shared/redact.ts`; re-verify)
- [ ] Per-integration scope audit — list every OAuth scope actually needed vs granted; drop unused
- [ ] Rate limiting on public endpoints (P0 Item 4; verify all endpoints covered)

### Audit log immutability

- [ ] Decision — hash-chain vs append-only: **append-only for MVP**, hash-chain deferred to v1.1+
- [ ] `audit_log` table: `id, user_id, actor (user|system|agent_role), action, resource_type, resource_id, payload, ip, ua, timestamp`
- [ ] Insert-only; no update/delete DDL granted to app role
- [ ] Retention: 1 year default, exportable
- [ ] Read-only replica view for admin UI queries
- [ ] Future upgrade path: add `prev_hash` column, backfill via nightly job, verify via `scripts/audit-verify.sh`

### Backup & recovery
- [ ] Nightly Postgres dump + Qdrant snapshot + MinIO sync
- [ ] Backup destination (parked question — decide)
- [ ] Restore runbook + tested end-to-end
- [ ] Recovery-key rotation flow

### Security — Item 7: data portability endpoints (see `plan/security.md`)
- [ ] `POST /me/export` → signed encrypted `.zip` in MinIO with `postgres.sql` (pg_dump --data-only user rows) + `files/` + `config.json` + `manifest.json` (list + hashes)
- [ ] Export completeness verified: row counts match across every user-owned table
- [ ] `POST /me/delete` — requires fresh re-auth + confirmation of username; deletes all user rows in one txn; revokes all sessions + agent devices + OAuth tokens
- [ ] Delete completeness verified: post-delete SELECT returns 0 across every user-owned table
- [ ] Both ops in audit log with actor + IP + timestamp
- [ ] CI test: seed → export → assert row + file parity

### Security — Item 8 (CI restore + off-site): backup verification
- [ ] Weekly CI job: fresh Docker volumes → restore latest backup → boot API → assert `setup_state=complete` → row counts match snapshot
- [ ] Off-site destination configured (S3 / Backblaze B2) — final answer to parked question
- [ ] RPO 24h / RTO 2h documented in `docs/backup.md`
- [ ] `age` encryption verified: backup byte-inspected, opaque without operator key

### AI safety — Items 7, 9 (see `plan/ai-safety.md`)

#### Item 7 — Agent approval gate wiring
- [ ] Every tool marked `requiresApproval` (send email, submit application, post to Slack, agent form-fill) routes through approval queue
- [ ] Approval item stores full tool invocation payload + agent reasoning
- [ ] Approval UI shows diff/preview per invocation
- [ ] Model never approves its own outbound action; user-only

#### Item 9 — Usage & Costs dashboard, advanced (extends the P1 basic dashboard on screen 52a)
- [ ] Cost projection card: linear + 7-day-trend extrapolation for end-of-month; comparison to budget
- [ ] Cache-hit rate per prompt (bar chart, sorted by savings)
- [ ] Latency histogram (p50 / p95 / p99) per prompt + per provider
- [ ] Error-rate chart per provider with drill-down to failing prompts
- [ ] Model-comparison view: side-by-side cost / latency / eval-pass-rate when multiple providers configured
- [ ] Golden-eval pass-rate chart per prompt (fed by nightly eval job from ai-safety Item 10)
- [ ] Export usage: CSV + JSON, filterable by window + dimension (provider / model / prompt / agent / sensitivity)
- [ ] Alert config UI: thresholds (daily cost, monthly cost, single-call cost, error rate) → webhook or Slack/email
- [ ] Anomaly detection: 7-day baseline; sudden spike flagged with severity + suspected cause
- [ ] Feedback loop: thumbs-down on any generated artifact → linked back to originating `llm_calls` row + added to eval set + increments prompt's regression counter
- [ ] Security stats surfaced: hallucination-suspect count, injection-detection flags, blocked-sensitivity count — with drill-through to the offending rows
- [ ] Per-user retention override (default 90d) — bulk delete older rows respects retention

### Frontend
- [ ] 45 Application detail (timeline, artifacts, audit)
- [ ] 46 Approval queue
- [ ] 47 Interview prep
- [ ] 48 Outreach composer
- [ ] 57 Storage (files, quotas, cleanup)
- [ ] 59 Security (sessions, keys, integrations)
- [ ] 60 Data & privacy (retention, deletion)
- [ ] 63 Backup & recovery
- [ ] 64 Audit log

### Testing (see `plan/testing.md`)

**Unit**
- [ ] Approval-queue state machine — every valid + every invalid transition
- [ ] Selector-health probe with mock allowlist entries
- [ ] Outreach send-time computation across timezones + business-hour rules
- [ ] ATS response parsing → application state update
- [ ] Audit-log append-only invariant (attempt update → error)

**Integration (Testcontainers)**
- [ ] Approval flow end-to-end: enqueue → user approves → ATS API called → response parsed → application state moves → audit_log written
- [ ] Restore test wired into CI (not just script): weekly job runs against test backup, boots stack, verifies parity

**Contract tests**
- [ ] Ashby application-submit API against recorded fixtures
- [ ] Greenhouse application-submit API against recorded fixtures

**LLM evals**
- [ ] `interview-prep-planner/` — 10+ (job, dossier, resume) → expected topic coverage
- [ ] `talk-track-generator/` — 15+ (topic, evidence) pairs; grounding invariants
- [ ] `outreach-composer/` — 15+ examples; fact-check passes

**Sandbox-adjacent**
- [ ] Agent form-fill against fixture site (Ashby-like) — success + selector-broken fallback both tested

**Playwright golden flow**
- [ ] Full approval → submission dry-run
- [ ] Data-portability export → download → contents match manifest
- [ ] Data-portability delete → typed-confirmation → all user data gone
- [ ] `checkA11y(page)` on 45, 46, 47, 48, 57, 59, 60, 63, 64

**Visual regression**
- [ ] Baselines for P6 screens

### Observability additions (see `plan/observability.md`)
- [ ] Metrics: `approvals_pending{type}`, `submissions_total{ats,result}`, `agent_form_fills_total{domain,result}`, `outreach_sent_total`, `interview_prep_sessions_total`, `backup_size_bytes`, `backup_duration_seconds`, `restore_test_pass{date}`
- [ ] Alerting recommendations in `docs/observability/alerts.md` (approvals > 24h old, submissions failing > 20%, backup missed, restore-test fail)

## Exit criteria
All boxes ticked, PLAN.md updated, product is v1.0.
