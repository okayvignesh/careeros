# Career OS — Security Spec

Cross-cutting security requirements for an open-source, self-hostable developer tool. Referenced from every phase file. If you add security-sensitive code, it must satisfy the item(s) below and pass the acceptance criteria.

**Target class:** Vaultwarden / Immich / Cal.com / PostHog-self-hosted tier. Not enterprise SaaS, not hobby script.

**Owner:** anyone editing security-sensitive code owns compliance with the item they touch. CI enforces what's automatable; the rest is checklist-gated at merge.

---

## Threat model

**We defend against:**
- Unauthenticated network attackers on the public internet
- Malicious dependencies (supply-chain)
- Credential theft (session hijack, cookie theft, phishing)
- Data exfiltration via LLM egress or worker outbound
- Accidental secret exposure (logs, backups, error messages)
- Configuration mistakes by the operator (weak keys, exposed ports)
- Prompt injection in ingested content (job descriptions, emails, GitHub READMEs)
- ToS / legal risk from unauthorized scraping

**We do NOT defend against:**
- A compromised operator (root on host = game over)
- Nation-state adversary with targeted zero-days
- Physical access to the VPS
- The user's own compromised browser session (agent + user's cookies = trust chain)
- LLM provider snapshotting prompts (we minimize but can't prevent)

**We accept:**
- Single-user default (multi-tenant threat surface is out of scope until we add it)
- Self-signed / Let's Encrypt certs (no EV cert requirement)
- No formal SOC 2 / ISO 27001 audit (impossible for a codebase; controls implemented regardless)

---

## The 6 pillars

| # | Pillar |
|---|---|
| 1 | Secure by default — bad configs refused at boot |
| 2 | Install in 5 minutes |
| 3 | Upgrade without fear (see `release-process.md`) |
| 4 | Zero surprise egress |
| 5 | Data belongs to the user |
| 6 | Trustable release chain |

---

## The 10 requirements

### 1. Secure defaults enforced at boot
**What:** API refuses to start if any required security config is missing, weak, or default. Startup fails loud with a specific error.

**Why:** OSS operators regularly leave `SECRET=changeme` in production. We refuse.

**Acceptance criteria:**
- [ ] `ENCRYPTION_KEY` — must be present, ≥ 32 bytes, not equal to any known example value → else exit 1 with clear message.
- [ ] `SESSION_SECRET` — same rules.
- [ ] Production mode (`NODE_ENV=production`) requires HTTPS reachable via configured host — else exit 1.
- [ ] Postgres connection must use TLS in production (`sslmode=require` or higher) → else exit 1.
- [ ] Default admin credentials do not exist. First user is created only via the setup wizard, never seeded.
- [ ] `startup-check.ts` runs before Nest bootstrap, tested in unit tests with negative cases.
- [x] Web middleware fails CLOSED to `/service-unavailable?next=<path>` when the API is unreachable (network error, 5s timeout, non-2xx); public routes still render. See `apps/web/src/middleware.ts:24-53` + `apps/web/src/middleware.test.ts` (A-M8).

**Phase:** P0

---

### 2. Full security headers + CSRF
**What:** Every HTTP response carries the modern security-header set; every state-changing endpoint requires a CSRF token.

**Why:** Defense in depth against XSS, clickjacking, cross-origin abuse. Cheap, high-value.

**Acceptance criteria:**
- [ ] `Content-Security-Policy`: nonce-based, no `unsafe-inline` in production, no `unsafe-eval`, explicit `default-src 'self'`, `frame-ancestors 'none'`.
- [ ] `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`.
- [ ] `X-Frame-Options: DENY`.
- [ ] `X-Content-Type-Options: nosniff`.
- [ ] `Referrer-Policy: strict-origin-when-cross-origin`.
- [ ] `Permissions-Policy` locks down camera, microphone, geolocation, payment, usb, etc. — all off unless a feature needs one.
- [ ] `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`.
- [ ] CSRF token on every `POST/PUT/PATCH/DELETE` (double-submit cookie pattern). Tokens rotated per session.
- [ ] Playwright test asserts headers present on `/`, `/setup`, `/api/health`.
- [ ] `securityheaders.com` gives grade A on the deployed site.

**Phase:** P0

---

### 3. WebAuthn / passkey MFA
**What:** After password, user can register a passkey (WebAuthn). Password-optional mode allows passkey-only login. TOTP not required.

**Why:** Phishing-resistant, better UX than TOTP, industry-standard, free (no SMS costs).

**Acceptance criteria:**
- [ ] `@simplewebauthn/server` + `@simplewebauthn/browser` integrated.
- [ ] User can register multiple passkeys (laptop + phone).
- [ ] User can name each passkey and revoke individually.
- [ ] `POST /auth/passkey/register/start` + `/finish`; `POST /auth/passkey/login/start` + `/finish`.
- [ ] Setup wizard prompts (but does not require) passkey registration at the recovery-key step.
- [ ] Session records which method was used (`password | passkey | password+passkey`).
- [ ] Sensitive ops (change password, revoke sessions, rotate encryption key) require fresh re-auth (< 5 min old).
- [ ] Playwright test: register passkey → sign out → sign in via passkey.

**Phase:** P0

---

### 4. Redis-backed adaptive rate limiter
**What:** Per-IP + per-user rate limiting on every public endpoint, with exponential lockout on repeated auth failures.

**Why:** Brute-force + credential-stuffing defense. Distributed across replicas via Redis.

**Acceptance criteria:**
- [ ] Global default: 100 req/min per IP on `/api/*`.
- [ ] Auth endpoints: 5 failures per IP triggers 1-min lockout, doubling to 32 min, then require passkey.
- [ ] Pairing endpoint (agent): 5 attempts per hour per IP.
- [ ] Setup endpoints: 20 req/min per IP.
- [ ] Rate-limit state in Redis, shared across API replicas.
- [ ] `Retry-After` header on 429 responses.
- [ ] `X-RateLimit-*` headers on all responses.
- [ ] Lockouts logged as security events.
- [ ] Unit test: burst → 429; wait → 200. Auth-brute-force test asserts lockout escalation.

**Phase:** P0

---

### 5. Field-level encryption for PII
**What:** Resume text, career goals, personal facts, and any user-authored free-text field encrypted at column level via `packages/secrets`. Postgres dump alone does not reveal PII.

**Why:** Belt-and-suspenders. Backup theft or DB leak doesn't equal PII disclosure.

**Acceptance criteria:**
- [ ] `packages/secrets` exposes `encryptField(text, context)` and `decryptField(cipher, context)`, using AES-GCM with a derived subkey per field type (context binding prevents ciphertext swap attacks).
- [ ] Prisma middleware (or Drizzle equivalent) auto-encrypts marked columns on write, decrypts on read.
- [ ] Marked tables: `resume_facts`, `career_goals`, `evidence` (where `type = self | document`), `applications`, `outreach_messages`.
- [ ] Migration is idempotent — running twice does not double-encrypt.
- [ ] Backup dump inspected in test: PII columns are opaque bytes.
- [ ] Search on encrypted columns via deterministic-encrypted secondary index only where required (documented per column).

**Phase:** P1 (when resume/goals data lands)

---

### 6. Zero telemetry by default + egress allowlist
**What:** Nothing calls out except services the operator configured. Workers cannot reach the internet except to a documented allowlist. Anonymous usage stats opt-in only, off by default, documented per data point.

**Why:** OSS trust cornerstone. Plex-style phone-home kills adoption.

**Acceptance criteria:**
- [ ] No analytics SDK in `apps/web` (no Google Analytics, no PostHog cloud, no Sentry cloud).
- [ ] Self-hosted error tracking only (GlitchTip in compose).
- [ ] `NEXT_TELEMETRY_DISABLED=1` set in web Dockerfile.
- [ ] Worker container's Docker network policy: outbound only to configured provider domains (DeepSeek, GitHub, Ashby, Greenhouse, Adzuna, Remotive, Arbeitnow, JSearch, Serpapi, MinIO, Postgres, Redis, Qdrant) — everything else blocked at network level.
- [ ] Allowlist rebuilt on config change; documented in `docs/egress.md`.
- [ ] Optional `USAGE_STATS=on` env var — sends `{version, install_id_hashed, feature_flags}` weekly to configurable endpoint. Off by default. Documented exactly what fields.
- [ ] `docs/security.md` lists every outbound network path with purpose.
- [x] GitHub PAT scope gate: `saveToken` calls `GET /user` and inspects `x-oauth-scopes` before persist; scopes outside `{repo, public_repo, read:user, user:email}` (or any of `admin:*`, `delete_repo`, `workflow`, `write:packages`, `delete:packages`, `write:discussion`) are refused with `InvalidTokenScopeError`; fine-grained PATs rejected for MVP; sync never enqueues on reject; each reject writes `audit_log` action `github.token.rejected` (`apps/api/src/modules/integrations/github/github.service.ts:55` and helpers at :211, :233; regression `github.service.test.ts`).

**Phase:** P0 (network policy scaffold) + P3 (real workers plug in)

---

### 7. Data portability endpoints
**What:** One-click export of everything as portable formats. One-click delete of all user data with token revocation.

**Why:** Pillar 5. GDPR-like posture without needing GDPR jurisdiction. Users own their data or leave.

**Acceptance criteria:**
- [ ] `POST /me/export` → returns URL to a signed, encrypted `.zip` in MinIO containing: `postgres.sql` (standard `pg_dump --data-only` for user's rows), `files/` (MinIO objects), `config.json` (non-secret config), `manifest.json` (list + hashes).
- [ ] Export is complete: match `SELECT COUNT(*)` across every user-owned table.
- [ ] `POST /me/delete` → requires fresh re-auth, requires typing username to confirm, deletes all user rows across all tables in one transaction, revokes all sessions + agent devices + OAuth tokens.
- [ ] Delete is complete: post-delete SELECT returns zero across every user-owned table.
- [ ] Both operations logged in audit log with actor + IP + timestamp.
- [ ] Export tested in CI against seeded data — asserts row-count parity + file-count parity.

**Phase:** P6

---

### 8. Encrypted, restorable backups
**What:** Nightly backups, encrypted before leaving host, restore tested weekly in CI. Restore uses standard `pg_restore` on any Postgres — no proprietary format.

**Why:** Pillar 5. An untested backup is a fiction.

**Acceptance criteria:**
- [ ] `scripts/backup.sh`: `pg_dump -Fc` + Qdrant snapshot + MinIO rsync → tar → `age` encrypt with operator's public key → ship to configured destination (S3-compatible, Backblaze B2, or local path).
- [ ] `scripts/restore.sh`: reverse. Documented in `docs/backup.md`.
- [ ] Compose cron sidecar runs backup nightly, retention: 7 daily + 4 weekly + 12 monthly.
- [ ] CI weekly job: fresh Docker volumes → restore latest backup → boot API → assert setup_state=complete → assert row counts match snapshot.
- [ ] RPO: 24h. RTO: 2h. Both documented.
- [ ] Backup destination is configurable; local path works out of the box.
- [ ] Master `ENCRYPTION_KEY` is NOT in the backup (it lives with the operator, backup is useless without it).

**Phase:** P0 (script + local destination) + P6 (CI restore test + off-site option)

---

### 9. Trustable release chain
**What:** Every release: signed commits, signed container images, SBOM published, checksums on GitHub Release. `SECURITY.md` with disclosure policy. See `release-process.md` for the mechanics.

**Why:** Pillar 6. OSS reputation compounds. `docker pull unknown/careeros:latest` is a hard sell.

**Acceptance criteria:**
- [ ] Sigstore `gitsign` configured; all merges to `main` signed.
- [ ] `cosign` signs every published container image; verification instructions in `docs/verify.md`.
- [ ] CycloneDX SBOM generated per release for each container; published as GitHub Release asset.
- [ ] GitHub Releases include `SHA256SUMS` for every asset.
- [ ] `SECURITY.md` at repo root: disclosure email, PGP key, response commitment, 90-day disclosure window, out-of-scope list.
- [ ] GitHub Advisories enabled; a private test advisory filed and closed to verify flow.
- [ ] Container images pinned by SHA-256 in `docker-compose.yml`, not `:latest`.

**Phase:** P0 (CI + `SECURITY.md`) — must exist before any `v0.x` tag

---

### 10. Vulnerability + container hygiene
**What:** Automated vulnerability detection at every layer, hardened containers, no `:latest` tags.

**Why:** Pillar 1 + 6. Silent CVEs are the OSS killer.

**Acceptance criteria:**
- [ ] Renovate configured, weekly PRs, security-patch PRs auto-merged when CI green.
- [x] CI gate: `pnpm audit --prod --audit-level=high` fails the build. (A-H7: `.github/workflows/pr.yml`)
- [ ] CI gate: CodeQL runs on every PR, blocks on high-severity SAST findings.
- [ ] CI gate: Trivy scans built images, blocks on HIGH/CRITICAL CVEs in packages we install.
- [ ] Base images: distroless (`gcr.io/distroless/nodejs20-debian12`) for api/worker; `nginx:alpine` pinned by digest for nginx.
- [ ] All containers run as non-root UID.
- [ ] All containers use read-only rootfs, tmpfs for writable dirs.
- [ ] All containers drop `ALL` Linux capabilities, add back only what's needed.
- [ ] Seccomp default profile applied.
- [ ] `docker-compose.yml` uses image digests, not tags.
- [ ] `gitleaks` pre-commit hook + CI job — no secrets in commits.

**Phase:** P0

---

## Bootstrap security defaults (goes in `apps/api/src/startup-check.ts`)

Runs before Nest bootstrap. Any failure = process exit 1 with a clear message pointing to the doc.

```
- ENCRYPTION_KEY present, ≥32 bytes, not in known-weak set
- SESSION_SECRET present, ≥32 bytes, not in known-weak set
- DATABASE_URL parses, uses SSL in production
- REDIS_URL reachable
- QDRANT_URL reachable
- MINIO endpoint reachable
- NODE_ENV set (production | development | test)
- If production: TRUSTED_ORIGINS set, includes at least the public host
- No process.env leaks: startup log redacts all env values (only key names)
```

## Ongoing hygiene

- Renovate PRs reviewed within 7 days.
- CVE advisories triaged within 48 hours.
- Security-relevant deps (auth, crypto, HTTP parsing) get manual review on every bump.
- Quarterly threat-model review — is the "we do NOT defend against" list still honest?
- Every phase's Playwright test includes at least one negative-security assertion (e.g., unauthenticated request to protected route → 401).

## Coverage matrix (phase → items)

| Phase | Items landing here |
|---|---|
| P0 | 1, 2, 3, 4, 6 (scaffold), 8 (local), 9, 10 |
| P1 | 5 |
| P3 | 6 (real workers + allowlist enforcement), prompt-injection defenses (out-of-band, part of §12 in AGENTS.md) |
| P6 | 7, 8 (CI restore test + off-site) |

## What NOT in this spec (deliberately)

- SSO/SAML/OIDC (single-user; add if adoption asks)
- HSM/KMS integration (env + Docker secrets is class norm)
- Tamper-evident hash-chain audit log (nice-to-have, not expected in class)
- mTLS between internal services (private Docker network is sufficient)
- Multi-region DR / RPO/RTO SLA (operator's job)
- Formal SOC 2 / ISO 27001 (requires an org)

## Verification

- **Every item above has explicit acceptance criteria.** A phase is not "done" for a security item until every checkbox is ticked AND a test exists to prevent regression.
- **Security-relevant PRs require a checklist in the description** — which items touched, how tested.
- **`docs/security.md`** (user-facing) mirrors this file in operator-friendly language.
