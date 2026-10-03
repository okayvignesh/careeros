# Security policy

Career OS is a self-hosted single-user tool that handles sensitive
personal data (resume, career goals, private emails, LLM API keys).
Security posture is documented in `plan/security.md`.

## Reporting a vulnerability

**Do not open a public GitHub issue for security-sensitive findings.**
A public issue discloses the problem before there is a fix.

### Primary channel: GitHub Security Advisories

Use the repository's private vulnerability reporting flow:

1. Open the **Security** tab of
   [`github.com/okayvignesh/careeros`](https://github.com/okayvignesh/careeros/security).
2. Click **Report a vulnerability** (GitHub Security Advisories).
3. Include the affected version or commit, reproduction steps, impact,
   and any suggested fix. A proof of concept helps a lot.

This opens a private thread visible only to you and the maintainer.
Advisories are the operational channel: triage, fix coordination, CVE
request, and the published advisory all happen there. This is the
channel to use.

### Backup email (not yet configured)

Email: `security@career-os.local`

**Placeholder. Do not send mail here. Replace this line with a real,
monitored address before the first public release.** Until it is
replaced, GitHub Security Advisories is the only working channel.

### What to expect

| Stage | Commitment |
|---|---|
| Acknowledge receipt | within 3 business days |
| Initial triage + severity assessment | within 7 days |
| Fix or workaround for high/critical | within 14 days |
| Default coordinated-disclosure window | 90 days, negotiable |
| Credit | in the advisory, unless you ask to stay anonymous |

### Supported versions

Security fixes target the versions inside the support window defined in
[`docs/support.md`](docs/support.md): the current major gets full
support; the previous major gets security patches only, until 6 months
after the current major shipped. Pre-release / `edge` builds are **not**
supported for security fixes. Please report against a tagged, supported
release where possible.

### Encrypted communication

GitHub Security Advisories is private end to end for the duration of
the report. No PGP key is pinned yet. If you need to exchange material
outside GitHub, say so in the advisory and a channel plus key can be
arranged before anything sensitive is sent.

## Scope

In scope:
- Any bug that lets a non-admin user access another user's data
  (multi-tenant leak; today the app is single-user but tables are
  scoped, so this still matters).
- Any path that exfiltrates secrets stored in `encrypted_secrets`.
- Any SSRF / RCE / SQLi vector.
- Any auth bypass on the browser session or the desktop-agent JWT.
- Any prompt-injection path that bypasses `wrapUntrusted` /
  `sensitivity-gate`.
- Any bypass of the approval queue for outbound actions.

Out of scope:
- Denial-of-service via ordinary rate-limit exhaustion (already
  enforced by @nestjs/throttler; a 429 is the intended outcome).
- Third-party service outages (Postgres, Redis, DeepSeek, GitHub,
  GitLab, Google, Slack).
- Findings against unshipped surfaces marked "deferred" in
  `plan/DEFERRED.md`.

## Threat model

See `docs/threat-model-operator.md` for the operator-facing threat
model (what an operator running Career OS on their own VPS needs to
worry about, and what controls are in place).

## Defensive controls

Summary of controls; full list in `plan/security.md`:

- **Auth**: passkey (`@simplewebauthn`) + password fallback; recovery
  codes; `__Host-` sealed cookies; server-side `active_sessions`
  revocation; exponential lockout on repeated failures; CSRF
  double-submit; `Sec-Fetch-Site: same-origin` enforcement.
- **Session / cookies**: `SameSite=Strict`, `Secure`, `HttpOnly`,
  `__Host-` prefix (name-locked to origin).
- **Rate limiting**: `@nestjs/throttler` + Redis; per-route caps on
  sign-in, setup, agent pairing, Gmail push webhook, LLM call
  concurrency.
- **Secrets**: `MASTER_KEY` 64-hex, argon2id password hashing,
  AES-256-GCM `encrypt(plaintext, KEK, purpose)` with AAD binding on
  every `encrypted_secrets` row.
- **Egress**: Docker `internal` + `egress` networks + Squid proxy;
  SSRF gate `assertPublicUrl()` refuses RFC1918/link-local/loopback.
- **LLM safety**: `wrapUntrusted` before every provider call,
  `injection-scan` on all user content, sensitivity gate + per-user
  concurrency limit + per-user budget cap.
- **Uploads**: magic-byte MIME check, MinIO per-user signed URLs,
  no client-provided mimetypes trusted.
- **Audit log**: append-only DDL grant (no UPDATE/DELETE to app
  role), 1y retention, read-only replica pattern; every mutating
  action writes an `audit_events` row.
- **Data portability**: `POST /me/export` + `POST /me/delete` with
  fresh re-auth + email confirmation; cascade + parity assertion.
- **OAuth scopes**: least-privilege audit in
  `docs/oauth-scope-audit.md`; install-time warning on missing or
  excess Slack scopes.

## Update cadence

- Weekly `pnpm audit --prod --audit-level=high` in CI (`.github/
  workflows/pr.yml`).
- Renovate (`.github/renovate.json`) opens grouped dep PRs Monday
  06:00 UTC.
- Monthly lock-file maintenance.
- Base image digests pinned; renovate updates them with each release.
