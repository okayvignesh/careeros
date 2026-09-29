# Security policy

Career OS is a self-hosted single-user tool that handles sensitive
personal data (resume, career goals, private emails, LLM API keys).
Security posture is documented in `plan/security.md`.

## Reporting a vulnerability

**Do not open a public GitHub issue for security-sensitive findings.**

Email: security@career-os.local
(Update this placeholder before public release. Until an OSS decision
lands per `plan/COMPLETION_PLAN.md` §6, this project is personal-use;
private disclosure means messaging the maintainer directly.)

We aim to acknowledge within 72 hours and to ship a fix or workaround
within 14 days for high-severity findings.

## PGP key

Placeholder pending OSS-public decision. When we cut v1.0, this section
will pin a full public key + fingerprint. For now, prefer
end-to-end-encrypted email or Signal.

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
