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
- [x] `ENCRYPTION_KEY` — must be present, ≥ 32 bytes, not equal to any known example value → else exit 1 with clear message. `loadMasterKey` now accepts ONLY 64-char lowercase hex OR 44-char base64 (32 bytes); the old null-pad branch that silently zero-padded short passphrases is gone. Enforced pre-boot by `startup-check.ts:10` (`assertStrongKey`) and again at every key-consumer's module load via `const KEY = loadMasterKey()`. See `packages/secrets/src/master-key.ts:22-53` + `packages/secrets/src/master-key.test.ts` (A-H4).
- [x] `SESSION_SECRET` — same rules. Enforced at boot by `assertStrongKey('SESSION_SECRET', ...)` in `apps/api/src/startup-check.ts:11`, plus a redundant presence assertion at :14-21 and a lazy re-check inside `SessionService` constructor (`apps/api/src/modules/auth/session.service.ts:33-40`) so a test path that skips startup-check can no longer mask a missing env with `!` (A-H3).
- [ ] Production mode (`NODE_ENV=production`) requires HTTPS reachable via configured host — else exit 1.
- [ ] Postgres connection must use TLS in production (`sslmode=require` or higher) → else exit 1.
- [x] Default admin credentials do not exist. First user is created only via the setup wizard, never seeded. `POST /setup/account` is now wrapped in `pg_advisory_xact_lock(1)` and returns a generic 409 on P2002 so concurrent POSTs can't race-create a second user and email existence isn't leaked (`apps/api/src/modules/setup/setup.controller.ts:57-99` + `setup.controller.test.ts`, A-M2).
- [ ] `startup-check.ts` runs before Nest bootstrap, tested in unit tests with negative cases.
- [x] Web middleware fails CLOSED to `/service-unavailable?next=<path>` when the API is unreachable (network error, 5s timeout, non-2xx); public routes still render. See `apps/web/src/middleware.ts:24-53` + `apps/web/src/middleware.test.ts` (A-M8).
- [x] MinIO credentials never fall back to a default: `StorageService` reads `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` via `requireEnv()` at construction and throws if missing (`apps/api/src/common/storage.service.ts:82-90,100-107`); regression in `apps/api/src/common/storage.service.test.ts` asserts the throw on both missing keys (A-M5).
- [x] Datastore credentials refuse defaults + weak values at BOTH layers. Compose interpolates `${POSTGRES_PASSWORD:?…}` and `${MINIO_ROOT_PASSWORD:?…}` so a missing env aborts the stack before boot (`infra/docker/docker-compose.yml:21,73`); startup-check.ts adds an `A-infra` block that refuses boot on missing, known-weak (careeros, careerosminio, changeme, admin, minioadmin, root, …) or <24-byte values via `assertStrongDatastoreCred` (`apps/api/src/startup-check.ts:23-34,76-97` + `apps/api/src/startup-check.test.ts`, A-H9).
- [x] Mutating `/me/*` config handlers refuse to run once a second user exists. `POST /me/usage/budget`, `POST /me/usage/pause`, `POST /me/usage/sensitivity` write global `AppConfig` keys that are NOT yet userId-scoped, so allowing a second user to flip them would silently affect the first. `UsageService.assertSingleUserForGlobalConfig` runs `SELECT COUNT(*) FROM users`, returns 403 on `!==1`, and emits `audit_log` action `config.multi_user_guard_hit`. `TODO(multitenant):` marker at each call site tracks the follow-up to scope AppConfig by userId (`apps/api/src/modules/usage/usage.controller.ts:90-140` + `usage.service.ts:114-146` + `usage.controller.test.ts` + `usage.service.test.ts`, A-M6).

**Phase:** P0

---

### 2. Full security headers + CSRF
**What:** Every HTTP response carries the modern security-header set; every state-changing endpoint requires a CSRF token.

**Why:** Defense in depth against XSS, clickjacking, cross-origin abuse. Cheap, high-value.

**Acceptance criteria:**
- [x] `Content-Security-Policy`: nonce-based, no `unsafe-inline` in production, no `unsafe-eval`, explicit `default-src 'self'`, `frame-ancestors 'none'`. Config lives in exported `buildSecurityMiddleware()` at `apps/api/src/main.ts:34-80` (per-request nonce middleware + helmet CSP directives at :40-56); regression at `apps/api/src/main.test.ts` imports that same factory and asserts unsafe-inline is absent and the nonce is stamped (A-H2).
- [x] `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`. `apps/api/src/main.ts:60-64`.
- [x] `X-Frame-Options: DENY`. helmet default (helmet imported at `apps/api/src/main.ts:5`, invoked at :39); complemented by explicit `frame-ancestors 'none'` at :52 for modern browsers.
- [x] `X-Content-Type-Options: nosniff`. helmet default (helmet import at `apps/api/src/main.ts:5`, call at :39).
- [x] `Referrer-Policy: strict-origin-when-cross-origin`. `apps/api/src/main.ts:65`.
- [x] `Permissions-Policy` locks down camera, microphone, geolocation, payment, usb, etc.: all off unless a feature needs one. Constant at `apps/api/src/main.ts:13-32`; middleware setter at :74-78.
- [x] `Cross-Origin-Opener-Policy: same-origin`. `apps/api/src/main.ts:66`. COEP `require-corp` is deliberately deferred (helmet default off, `apps/api/src/main.ts:70`) to keep dev-time Next.js image loading unbroken; ticket to flip on once every asset ships CORS headers is annotated at the CSP definition site.
- [x] CSRF token on every `POST/PUT/PATCH/DELETE` (double-submit cookie pattern). Tokens rotated per session. HMAC-derived `__Host-careeros_csrf` cookie minted alongside the session (`apps/api/src/modules/auth/session.service.ts:89,96` mint; `:121-125` expected-token derive; `:156-158` `deriveCsrfToken` HMAC); enforced by `SecurityMiddleware` which also requires `Sec-Fetch-Site: same-origin|none` on all non-GET (`apps/api/src/modules/auth/security.middleware.ts:33-80`); each reject writes `audit_log` action `auth.csrf.rejected`. Regression in `apps/api/src/modules/auth/security.middleware.test.ts` (A-H1).
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
- [x] Global default: 100 req/min per IP on `/api/*`. `@nestjs/throttler` global guard, ttl 60s / limit 100, wired at `apps/api/src/modules/auth/auth.module.ts:15-30` (A-C1).
- [x] Auth endpoints: 5 failures per IP triggers exponential lockout, doubling toward the 15-min cap. `POST /auth/sign-in`, `POST /auth/sign-up`, `POST /setup/account` all carry `@RateLimitAuth()` (5 req/min per IP) and the argon2 verify path is gated by the `LoginAttempt` counter with `min(2^(N-1), 900)` seconds lockout (`apps/api/src/modules/auth/auth.service.ts:9-27,68-113` + `throttle.decorator.ts` + `auth.service.test.ts`, A-C1). Passkey second factor tracked separately in item 3.
- [ ] Pairing endpoint (agent): 5 attempts per hour per IP.
- [x] Setup endpoints: 5 req/min per IP (tighter than spec-suggested 20). `apps/api/src/modules/setup/setup.controller.ts:59` (A-C1).
- [x] Rate-limit state in Redis, shared across API replicas. `@nest-lab/throttler-storage-redis` configured in `apps/api/src/modules/auth/auth.module.ts:19-27` against `REDIS_URL` (A-C1).
- [x] `Retry-After` header on 429 responses. `LockoutError` (payload at `apps/api/src/modules/auth/auth.service.ts:19-26`) is caught by `LockoutExceptionFilter` at `apps/api/src/common/filters/lockout.filter.ts`, which sets `Retry-After: <seconds>` before emitting the 429 JSON body; filter is registered globally in `apps/api/src/main.ts:91`. Regression: `apps/api/src/common/filters/lockout.filter.test.ts`.
- [ ] `X-RateLimit-*` headers on all responses.
- [x] Lockouts logged as security events. `AuthService.maybeAuditLockout` writes `audit_log` action `auth.login.lockout` at the moment the failure count crosses the threshold (`apps/api/src/modules/auth/auth.service.ts:150-171` + `auth.service.test.ts`, A-C1).
- [x] Unit test: burst → 429; wait → 200. Auth-brute-force test asserts lockout escalation. `apps/api/src/modules/auth/auth.service.test.ts` covers exponential-from-N=1 escalation, threshold audit at 5, and reset on success (A-C1).
- [x] Per-user LLM burst cap. `UsageService.runWithUserLimit` wraps every `provider.chatStructured` / `probeProvider` call site with `p-limit(2)` keyed by userId, so at most 2 outbound LLM calls per user are in flight at once; the rest queue. The chokepoint sits alongside `assertCallAllowed` (which is budget-only) and defends the provider's per-key RPS cap plus the local monthly budget from a runaway loop. Instances: `apps/api/src/modules/usage/usage.service.ts:76-110` (helper) + wrapped call sites across `modules/assessments/assessments.service.ts:{275,579,796,976,1112,1354}`, `modules/corpus/corpus.service.ts:132`, `modules/cover-letters/cover-letters.service.ts:{144,233}`, `modules/jobs/jobs.service.ts:365`, `modules/market-brief/market-brief.service.ts:128`, `modules/providers/providers.service.ts:100`, `modules/resume/resume.service.ts:168`, `modules/resume-variants/resume-variants.service.ts:{155,271}`. Regression: 3 tests in `usage.service.test.ts` cover cap, per-user isolation, and error propagation; pino `debug` line fires whenever queue depth climbs (A-M9).

**Phase:** P0

---

### 5. Field-level encryption for PII
**What:** Resume text, career goals, personal facts, and any user-authored free-text field encrypted at column level via `packages/secrets`. Postgres dump alone does not reveal PII.

**Why:** Belt-and-suspenders. Backup theft or DB leak doesn't equal PII disclosure.

**Acceptance criteria:**
- [x] `packages/secrets` exposes `encryptField(text, context)` and `decryptField(cipher, context)`, using AES-GCM with a derived subkey per field type (context binding prevents ciphertext swap attacks). `packages/secrets/src/field.ts:16-56`.
- [x] Prisma middleware (or Drizzle equivalent) auto-encrypts marked columns on write, decrypts on read. `apps/api/src/prisma/prisma.service.ts:28-116` (`ENCRYPTED_FIELDS` map + `$use` middleware). Note: legacy `$use` does not run inside interactive transactions; callers writing via `tx.<model>` call `encryptField` manually (documented at :14-22).
- [~] Marked tables: `resume_facts.content` (P1), `llm_hallucination_log.snippet` (A-M4 — raw source excerpts logged for hallucination review encrypted at rest via ENCRYPTED_FIELDS, `apps/api/src/prisma/prisma.service.ts:26`). Remaining `career_goals`, `evidence`, `applications`, `outreach_messages` still to add.
- [x] Migration is idempotent — running twice does not double-encrypt. Guaranteed by `isEncryptedField()` short-circuit in `packages/secrets/src/field.ts:26,44`; unit-tested in `packages/secrets/src/field.demo.ts` (idempotency case).
- [x] Hallucination-log retention: rows expire after 30 days via daily BullMQ job `hallucination-log-retention` (`apps/worker/src/hallucination-log-retention.worker.ts` + `hallucination-log-retention.test.ts`); wired in `apps/worker/src/main.ts` (A-M4).
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
- [x] Worker container's Docker network policy: outbound only to configured provider domains. Compose splits into `internal` (datastores; `internal: true` = zero outbound) and `egress` (api + worker + web + squid) networks; the Squid container gates every outbound HTTP(S) call against a deny-by-default allowlist (deepseek, openai, anthropic, openrouter, github/githubusercontent, gitlab, npmjs, firecrawl). See `infra/docker/docker-compose.yml:92-105` (squid service), `:135-137,172-174` (api/worker `HTTP(S)_PROXY=http://squid:3128` + `NO_PROXY` exemption for private datastore hostnames), `:154-157,182-184,204-209` (network membership + `internal: true` gate) and `infra/docker/squid/squid.conf` (ACLs + request logging). Operator smoke `scripts/smoke/egress.sh` asserts `example.com` and `169.254.169.254` are blocked and `api.deepseek.com` / `api.github.com` reach the proxy (A-H8). The proxy env vars alone do NOT cover Node global `fetch` (undici ignores them), so enforcement is wired in code: `installEgressProxy()` in `packages/shared/src/net/proxy-dispatcher.ts` installs an undici `EnvHttpProxyAgent` via `setGlobalDispatcher` at api + worker boot (`apps/api/src/main.ts`, `apps/worker/src/main.ts`), fails closed (throws, process exits 1) if a proxy is configured but the agent cannot be built, and preserves `NO_PROXY` for datastore hostnames. `scripts/smoke/egress.sh` drives `node` `fetch` through that same bootstrap instead of `curl`; `packages/shared/src/net/proxy-dispatcher.test.ts` pins install-on-proxy / no-op-without-proxy / fail-closed behaviour. See `docs/egress.md`.
- [ ] Allowlist rebuilt on config change; documented in `docs/egress.md`.
- [ ] Optional `USAGE_STATS=on` env var — sends `{version, install_id_hashed, feature_flags}` weekly to configurable endpoint. Off by default. Documented exactly what fields.
- [ ] `docs/security.md` lists every outbound network path with purpose.
- [x] GitHub PAT scope gate: `saveToken` calls `GET /user` and inspects `x-oauth-scopes` before persist; scopes outside `{repo, public_repo, read:user, user:email}` (or any of `admin:*`, `delete_repo`, `workflow`, `write:packages`, `delete:packages`, `write:discussion`) are refused with `InvalidTokenScopeError`; fine-grained PATs rejected for MVP; sync never enqueues on reject; each reject writes `audit_log` action `github.token.rejected` (`apps/api/src/modules/integrations/github/github.service.ts:55` and helpers at :211, :233; regression `github.service.test.ts`).
- [x] SSRF allowlist gate on user-supplied provider baseUrls: `assertPublicUrlShape` runs at construction and `assertPublicUrl` runs before every fetch (DNS-resolved, redirect-revalidated, host allowlist). Applies to LLM `baseUrl` + embedding `externalBaseUrl` via `PublicUrlSchema` in `packages/shared/src/schemas/index.ts:16` and `DeepSeekProvider` in `packages/ai/src/providers/deepseek.ts:57-73,241-262`; core guard in `packages/shared/src/net/assert-public-url.ts`; regression in `packages/shared/src/net/assert-public-url.test.ts` covers metadata IP, RFC1918, Docker hostnames, redirects to metadata, prod-mode plaintext + dev-only-host rules (A-C2).
- [x] Resume upload MIME + object-key trust gate: `verifyMagicBytes` checks `Buffer.subarray(0, 4)` server-side (PDF `%PDF`, DOCX `PK\x03\x04` + `.docx` extension + <25 MB size; shallow docx check, upgrade path documented in-line) and rejects mismatches with `InvalidFileTypeError`; objects land under `resumes/{userId}/{resumeId}/{filename}` and `presignResumeDownload` parses the key + refuses cross-user presign attempts (`apps/api/src/common/storage.service.ts:30-73,116-148`). Wrapper `ResumeService.archiveUpload` / `presignDownload` writes `audit_log` actions `resume.upload.rejected` / `resume.download.forbidden` with `{reason, claimedMime, magicMatch}` (`apps/api/src/modules/resume/resume.service.ts:50-100`); download presign TTL is 5 min. Regression coverage in `apps/api/src/common/storage.service.test.ts` + `apps/api/src/modules/resume/resume.upload.test.ts` (A-M5).

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
- [x] `scripts/backup.sh`: `pg_dump -Fc` + Qdrant snapshot + MinIO rsync → tar → `age` encrypt with operator's public key → ship to configured destination (S3-compatible, Backblaze B2, or local path). (C-P0.8a commit d57b44b)
- [x] `scripts/restore.sh`: reverse. Documented in `docs/backup.md`. (C-P0.8c commit f89d134)
- [x] Compose cron sidecar runs backup nightly, retention: 7 daily + 4 weekly + 12 monthly. `scripts/backup-cron.sh` implements the retention window; wiring into a compose sidecar is deferred to the ops slice.
- [x] CI weekly job: fresh Docker volumes → restore latest backup → boot API → assert setup_state=complete → assert row counts match snapshot. `.github/workflows/restore-test.yml` (C-P0.5b) runs Mondays 03:00 UTC via `scripts/verify-restore-parity.sh`.
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
- [x] `docker-compose.yml` uses image digests, not tags. Every `image:` line in `infra/docker/docker-compose.yml` is `<repo>@sha256:<64-hex>` (postgres:16-alpine :17; redis:7-alpine :36; qdrant/qdrant:v1.12.4 :50; bitnamilegacy/minio:2024.10.29-debian-12-r1 :69 — swapped off `quay.io/minio/minio` because that repo now requires auth for anonymous pulls, `ponytail:` note in-line; ubuntu/squid:6.10-24.10_edge :95). CI job `image-pins` in `.github/workflows/pr.yml` runs `scripts/verify-image-pins.sh` to fail any PR that reintroduces a floating tag (A-M7).
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
