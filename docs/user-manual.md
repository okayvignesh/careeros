# User manual

Career OS is a self-hosted single-user tool that builds a continuously
updated digital twin of your career (resume + GitHub + assessments +
market signals + application outcomes) and runs daily learning + job
execution against it, with every outbound action gated by an approval
queue.

This manual walks the main user flows. For install + ops see
`docs/install.md` + `docs/runbook.md`.

## First-run wizard

1. Open the web UI; the middleware redirects to `/setup` until the
   wizard completes.
2. **Account** - email + password; optionally enrol a passkey. Save
   the recovery codes offline.
3. **AI provider** - DeepSeek is the default (self-host-friendly cost).
   Paste the API key; it is encrypted at rest. Alternatives: OpenAI,
   Anthropic, OpenRouter, local Ollama.
4. **Embedder** - local `bge-small-en` by default; opt-in external
   provider if you want higher-dim embeddings.
5. **Integrations** - GitHub PAT (scopes: `repo` + `read:user` +
   `user:email`), GitLab PAT, Gmail OAuth, Slack install. All optional
   but each unlocks a slice of the product.
6. **Career goals** - target roles + locations + comp band. Can be
   edited later.

The wizard writes everything server-side; a half-finished wizard
can resume on next sign-in.

## Daily use

### Dashboard

Lands you on `/dashboard` showing:

- XP + level + streak (gamified learning progress)
- Open quests the system has queued for you based on skill gaps
- Recent job matches
- Recent interview prep + outreach drafts awaiting approval

### Daily brief

The system can push a daily brief at your preferred local hour
(default 08:00). Set up:

- **Settings -> Daily brief -> Enable** and pick your timezone + hour.
- Choose channels: `web` (in-app) and/or `slack` (when wired).
- Snooze for N days via `POST /brief/snooze` or
  `/brief --snooze <N>` from Slack (once that wire lands).

Composed briefs persist to `audit_events` so the latest can be
replayed from `/brief/latest`.

### Assessments

Six assessment types (knowledge, code-review, system-design,
debugging, mock-interview, boss-battle):

- `/arena/knowledge` - practice questions seeded by LLM, graded
  by LLM + rule-based fallback.
- `/arena/code-review` - critique a code diff; grader scores
  completeness + severity accuracy.
- `/arena/system-design` - markdown-friendly design canvas; graded
  against a 5x5 rubric (scalability / reliability / cost /
  trade-offs / clarity).
- `/arena/debugging` - fix broken code; grader scores correctness
  + minimality.
- `/arena/mock-interview` - 2 technical + 1 behavioural question
  batch.
- `/arena/boss/<milestone>` - timed 5-question challenge unlocked at
  level milestones (10, 25, 50, 75, 100).

Every attempt feeds XP, streak, and the skill-state aggregator.

### Jobs + matcher

- `/jobs` - jobs ingested from your GitHub / GitLab / Gmail alerts /
  ATS adapters.
- Each job has a match score vs your current skill state + resume.
- Reject-audit: thumbs down removes the job and records the reason
  so the pipeline can filter similar ones.

### Applications

- `/applications/<id>` - timeline + artifacts (resume variant +
  cover letter + interview prep).
- States: `interested -> applied -> interviewing -> offer -> rejected`
  (plus `ghosted`).
- `POST /interview-prep/:applicationId` - generate interview prep
  topics.
- `POST /interview-prep/:applicationId/talk-tracks` - draft a 60-90s
  verbal answer for a topic (fact-checked against your evidence
  catalogue; refused on bogus or unsupported claims).

### Resume + cover letter

- Base facts live in `resume_facts` + the evidence graph.
- `POST /resume-variants` - generates a job-tailored variant via LLM;
  grounded; fact-checked.
- `POST /cover-letters` - same contract, per paragraph.
- Both support DOCX export in addition to the default PDF render.

### Outreach

- `POST /outreach` - pick a template (`cold-reach`, `warm-referral`,
  `event-followup`, `alumni-connection`, `application-followup`),
  an industry variant (`default`, `startup`, `enterprise`,
  `academia`), and a recipient; the composer drafts + fact-checks.
- Status transitions `draft -> approved -> sent`; never batch-sent.
- When the Gmail compose scope ships, approved drafts post to your
  Gmail Drafts for one-click send. Until then, copy-paste from the
  draft.

### Inbox triage

- `/inbox` - every inbound email classified into one of 9 classes
  (recruiter, interview_invite, assessment, rejection, offer, three
  job_alert_* variants, other).
- Auto-linked to an open application when the fuzzy match on
  (company, role) is >= 0.85 confidence; otherwise queued as `new`
  for manual link.
- `POST /inbox/:id/link` with `{ applicationId }` to override; the
  `by` field records whether `auto` or `user` created the link.

### Market brief

- `POST /market-brief` - LLM-synthesised weekly summary of what's
  moving in your job segment (rising skills, comp changes, remote
  share), grounded in stats from your personal job pipeline.

### Usage + costs

- `/settings/usage` - daily + monthly cost, calls-by-prompt,
  latency, provider breakdown.
- `/me/usage/cost-projection` - EOM extrapolation vs budget.
- `/me/usage/anomaly` - today's spend vs 7-day rolling median; flags
  "typo ran a batch 100x" style spikes.
- `/me/usage/export?format=csv` - full raw usage dump.

### Data portability

- `POST /me/export` - full JSON dump of every user-owned table
  (per-table SHA-256 manifest). Fresh re-auth required.
- `POST /me/delete` - right-to-erasure; confirm email + fresh re-auth;
  cascades across every row + nulls PII on audit-adjacent rows per
  the audit-log immutability policy.

## Signing out + session management

- One active session per device by default; `POST /auth/sign-out`
  revokes the current cookie.
- Password change revokes every active session server-side (even
  cookies issued before the change).

## Keyboard-adjacent

- `?` opens the keyboard shortcuts sheet.
- `g d` jumps to Dashboard; `g a` to Arena; `g j` to Jobs.

## Where to go next

- Operator-facing: `docs/runbook.md`, `docs/backup.md`,
  `docs/incident-response.md`.
- Security policy: `SECURITY.md`, `docs/threat-model-operator.md`.
- Architecture + flow: `docs/architecture.md`.
- Setup per integration: `docs/slack-setup.md`, `docs/gmail-setup.md`.
