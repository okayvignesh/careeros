# Career OS — Deep Security Audit

Scope: `apps/api`, `apps/web`, `apps/worker`, `packages/{ai,auth,secrets,shared,resume-render,job-pipeline,embeddings}`, `infra/docker`. Cross-referenced against `plan/security.md` items 1–10 and `plan/ai-safety.md` items 1–10.

## Severity totals (by category)

| Category | Critical | High | Medium | Low |
|---|---|---|---|---|
| 1 AuthN/AuthZ | 0 | 2 | 1 | 1 |
| 2 Secrets | 0 | 1 | 2 | 0 |
| 3 LLM safety | 0 | 1 | 1 | 1 |
| 4 Injection (SQL/XSS/path) | 0 | 0 | 0 | 0 |
| 5 SSRF | 1 | 1 | 0 | 0 |
| 6 CORS/CSRF | 1 | 1 | 1 | 0 |
| 7 Rate limit / brute force | 1 | 0 | 1 | 0 |
| 8 Upload / MinIO | 0 | 1 | 1 | 0 |
| 9 Dep vulns | 0 | 2 | 0 | 0 |
| 10 Playwright allowlist | — | — | — | — |
| 11 Docker / infra | 0 | 2 | 2 | 0 |
| **Totals** | **2** | **11** | **9** | **2** |

Category 10 (Playwright agent allowlist): `packages/browser-agent` does not exist yet. Not audited; gap noted below.

---

## CRITICAL

### C1. No rate limiting anywhere on the API — credential-stuffing wide open
- Category: 7 (rate limit / brute force)
- File: `apps/api/src/main.ts:11-38`, `apps/api/package.json` (no `@nestjs/throttler`, `express-rate-limit`, or Redis limiter dep)
- What's wrong: `POST /auth/sign-in` (`apps/api/src/modules/auth/auth.controller.ts:31-40`) has zero rate-limit middleware and no failure lockout. Argon2id verify is intentionally slow, so failed attempts cost the server more than the attacker; combined with no lockout this is a DoS + brute-force vector on a single-user install. `packages/auth/src/argon2.ts:3-8` uses OWASP-min params (19 MiB, t=2, p=1) — bursty stuffing quickly saturates the box.
- Fix: add a Redis-backed limiter (item spec is `packages/rate-limit`); minimum today: `@nestjs/throttler` with `ThrottlerStorageRedis`, `{ ttl: 60_000, limit: 100 }` global, `{ ttl: 60_000, limit: 5 }` on `POST /auth/sign-in` + `POST /setup/account`; exponential lockout in a `LoginAttempt` table.
- Maps to: security.md **item 4** (Redis rate limiter — not implemented).

### C2. Provider `baseUrl` is unrestricted — server-side request forgery via LLM config
- Category: 5 (SSRF)
- File: `packages/shared/src/schemas/index.ts:16` (`baseUrl: z.string().url().optional()`) → consumed at `packages/ai/src/providers/deepseek.ts:47` and `apps/api/src/modules/{resume,jobs,corpus,cover-letters,market-brief,resume-variants,assessments}/*.service.ts` via `new DeepSeekProvider({ baseUrl: cfg.baseUrl })`.
- What's wrong: any authenticated user can set `baseUrl` to `http://169.254.169.254/latest/meta-data/`, `http://localhost:9001`, `http://minio:9000`, `http://postgres:5432`, or any internal Docker service. Every prompt call then POSTs the API key + user prompt to that endpoint, and the response body is deserialised as JSON, parsed by Zod, and used. Response `error.message` is thrown as a string, which surfaces internal error text to the client — a classic blind→semi-blind SSRF. Worker also inherits this via `apps/worker/src/github-sync.ts` (Octokit `baseUrl` is fixed, but the same class of misuse exists for future LLM adapters).
- Fix: reject non-HTTPS in production; enforce an allow-list `{ 'api.deepseek.com', 'api.openai.com', 'api.anthropic.com', 'openrouter.ai', 'localhost', 'ollama' }`; DNS-resolve the host and refuse RFC1918 / link-local / loopback (`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`, `fc00::/7`); block redirects (`redirect: 'manual'`). Same fix must apply to `EmbeddingConfigSchema.externalBaseUrl` (schemas/index.ts:28).
- Maps to: security.md **item 6** (egress allowlist — scaffold only, no enforcement).

---

## HIGH

### H1. No CSRF protection — SameSite=Lax cookies + credentialed CORS = cross-origin state change
- Category: 6 (CORS/CSRF)
- File: `apps/api/src/modules/auth/session.service.ts:29`, `apps/api/src/main.ts:31-34`
- What's wrong: session cookie is `SameSite=Lax` (not `Strict`) and `credentials: true` on CORS. Every state-changing endpoint (`POST /auth/sign-in`, `POST /setup/*`, `POST /me/usage/pause`, `DELETE /me/applications/:id`) is protected only by the session cookie — no CSRF token, no origin check, no double-submit. `Lax` still lets top-level GETs carry the cookie, and Nest happily accepts JSON bodies without content-type gating. A malicious page can POST an HTML form (`enctype=text/plain`) to `/me/usage/pause` and the browser will send the cookie.
- Fix: `csrf-csrf` npm pkg, double-submit token pattern with `HMAC(SESSION_SECRET, sessionId)`. Alternatively require `Sec-Fetch-Site: same-origin` on every non-GET (cheap, no token plumbing). Add `SameSite=Strict` unless the wizard needs cross-domain flow (it doesn't).
- Maps to: security.md **item 2** (CSRF token requirement — not implemented).

### H2. Security headers are minimal — no HSTS, no COOP, no Permissions-Policy
- Category: 6 (CORS/CSRF)
- File: `apps/api/src/main.ts:14-29`
- What's wrong: `helmet()` is called with `crossOriginEmbedderPolicy: false` and a CSP that permits `'unsafe-inline'` in `style-src`. Missing headers required by spec:
  - `Strict-Transport-Security` — not sent (helmet default is 180d, spec wants 2y+preload)
  - `Permissions-Policy` — not set
  - `Cross-Origin-Opener-Policy: same-origin` — not set (COEP off by default)
  - `Referrer-Policy` — not explicitly set (helmet default = `no-referrer`; spec wants `strict-origin-when-cross-origin`)
- Fix: replace with explicit config (see security.md §2 checklist). Drop `unsafe-inline` from `style-src` and use nonces once Next builds CSS with hashes.
- Maps to: security.md **item 2**.

### H3. Session forgery escape — `SESSION_SECRET` is not `assertStrongKey`-gated for the sealing key path
- Category: 1 (AuthN)
- File: `apps/api/src/startup-check.ts:10-11`, `packages/auth/src/session.ts:16-18`
- What's wrong: startup asserts `SESSION_SECRET` present + strong, but session sealing uses `createHash('sha256').update(secret).digest()` which reduces any secret to a 32-byte key without HKDF. That's fine, but there is no boot-time rotation ceremony and no `iss`/`aud` in the sealed payload — a leaked cookie remains valid for 168 h regardless of password change. `SessionService` also loads `SESSION_SECRET` from `process.env` at module-load time (`session.service.ts:8` — `const SECRET = process.env.SESSION_SECRET!`). If the env var is missing when the module is imported (e.g. tests that skip startup-check), the `!` masks the failure and `unseal` silently derives from `undefined` → hashes `"undefined"` → predictable key.
- Fix: pull `SESSION_SECRET` inside the class after `runStartupChecks()` guarantees presence; store `sessionId` (random 16 bytes) inside the sealed payload and keep an `active_sessions` table so password change / logout can revoke; add `iat` invalidation on password reset.
- Maps to: security.md **item 1** (secure boot defaults — partial).

### H4. `loadMasterKey` silently truncates + null-pads short non-hex keys
- Category: 2 (Secrets)
- File: `packages/secrets/src/master-key.ts:22-28`
- What's wrong: `assertStrongKey` checks length ≥ 32 bytes, but `loadMasterKey`'s fallback (`value.padEnd(32, '\0').slice(0, 32)`) accepts anything that isn't 64-hex, pads it with **null bytes**, and truncates to 32. A 32-char ASCII password with a leading BOM or a 40-char base64 string silently loses entropy through null-padding. Combined with `WEAK_SET` only listing a handful of literals, an operator can set `ENCRYPTION_KEY=my-really-secret-passphrase!!` (32 bytes) and think it's fine; actual key material is 32 bytes but with tiny effective entropy.
- Fix: require exactly 64 hex chars OR 44-char base64 (32 bytes). Reject everything else with `throw new Error('ENCRYPTION_KEY must be 32 bytes as hex (64 chars) or base64. Generate: openssl rand -hex 32')`. Delete the null-pad branch.
- Maps to: security.md **item 1**.

### H5. Structured LLM output has no schema-fail retry, no ceiling on tokens — cost blow-up + prompt-injection surface
- Category: 3 (LLM safety)
- File: `packages/ai/src/providers/deepseek.ts:74-86`, `apps/api/src/modules/*/*.service.ts` (every LLM caller)
- What's wrong: `chatStructured` does `schema.parse(JSON.parse(raw))` with zero retry, no `max_tokens` on the request, and no pre-flight token estimate (ai-safety.md item 9 caps not implemented). A malicious job description or resume that induces a JSON error, or a runaway generation, silently 500s the caller (client sees stack). No injection-detection pass (`packages/ai/injection-scan.ts` does not exist) so `wrapUntrusted` is the sole defence. Also `chatStructured` sends `response_format: { type: 'json_object' }` but the schema-mismatch path throws instead of retrying once with the error appended.
- Fix: set `max_tokens` (per-prompt override, default 4096); on `ZodError` retry once with `{ role: 'system', content: 'Previous response failed schema: <err>. Return valid JSON.' }`; add `packages/ai/injection-scan.ts` (regex for `IGNORE PREVIOUS`, `SYSTEM:`, `<|`, base64 blobs, unicode tag chars) and gate untrusted content through it.
- Maps to: ai-safety.md **items 2, 5, 9**.

### H6. GitHub PAT stored per-user is scoped-blind — worker uses whatever the user pasted
- Category: 5 (SSRF) — data exfiltration variant
- File: `apps/api/src/modules/integrations/github/github.service.ts:25-58`, `apps/worker/src/github-sync.ts:64`
- What's wrong: `GithubConnectSchema` (`packages/shared/src/schemas/index.ts:33-35`) accepts any token 20–500 chars. No scope check via `GET /user` scopes header, no confirmation the token is `read:user, repo:read`. A user may paste a full-write PAT; a compromised session then exfiltrates code AND lets the worker push. `saveToken` immediately kicks a `github.sync` job (line 55) before verifying scope. Token is also used to enumerate **private** repos (`affiliation: 'owner,collaborator'`, `github-sync.ts:93`).
- Fix: on `saveToken`, check `res.headers['x-oauth-scopes']` and require scopes ⊆ `{repo,read:user}` (or explicitly warn); block if `admin:*` / `delete_repo` / `workflow` present. Consider mandating fine-grained PAT in the UI copy.
- Maps to: security.md **item 6** (documented outbound path) + gap (scope validation not in security.md).

### H7. `multer` 1.4.5-lts.1 + `pdf-parse` 1.1.1 — known-vulnerable, unmaintained deps
- Category: 9 (Dep vulns)
- File: `apps/api/package.json:33,35`
- What's wrong: `multer@1.x` has multiple advisories (CVE-2022-24434 DoS, CVE-2024-4067). Multer 2.x is the maintained line. `pdf-parse@1.1.1` last publish 2018; unpatched `pdfjs-dist` transitive with known DoS and prototype-pollution CVEs against crafted PDFs — exact code path is `apps/api/src/modules/resume/resume.service.ts:53` where uploaded PDFs are parsed with a 10 MB cap but no page-count sandbox.
- Fix: bump `multer` to `^2.0.0`; replace `pdf-parse` with `pdfjs-dist` used directly or `unpdf`. Add `pnpm audit --prod --audit-level=high` to CI (spec item 10 not wired).
- Maps to: security.md **item 10**.

### H8. Worker container has no egress isolation
- Category: 11 (Docker/infra)
- File: `infra/docker/docker-compose.yml:106-123`, `apps/worker/src/github-sync.ts`
- What's wrong: `worker` service on the same `internal` bridge network as api/db/redis; no `network_mode`, no iptables egress rules, no Docker `--dns` restriction. Blueprint egress allowlist (security.md item 6) says worker should only reach configured providers — currently it can reach `169.254.169.254`, the host, any external site. Same for `api`.
- Fix: separate `egress` network scoped to worker with explicit `extra_hosts` / DNS; or run worker behind a Squid egress proxy in the compose; or use `network: none` + userland proxy per allowed host.
- Maps to: security.md **item 6**.

### H9. Docker Compose ships default Postgres + MinIO credentials, no separation
- Category: 11 (Docker/infra)
- File: `infra/docker/docker-compose.yml:8-10,53-54,72,78-79`
- What's wrong: `POSTGRES_PASSWORD: careeros` hardcoded (not `${POSTGRES_PASSWORD}`); `MINIO_ROOT_PASSWORD: careerosminio` default via `${…:-careerosminio}`. If a first-time operator forgets to override, containers boot with predictable creds — same class as the "SECRET=changeme" pillar the spec explicitly forbids. Startup check does NOT validate Postgres/MinIO passwords (`apps/api/src/startup-check.ts` covers only `ENCRYPTION_KEY`/`SESSION_SECRET`).
- Fix: remove defaults; refuse to boot if `POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD` unset or in a `WEAK_SET`; document in `.env.example` only.
- Maps to: security.md **item 1**.

---

## MEDIUM

### M1. Session cookie lacks `__Host-` prefix / `Path=/` scope + no `Secure` in dev
- Category: 6 (CORS/CSRF)
- File: `apps/api/src/modules/auth/session.service.ts:29`
- What's wrong: cookie name is user-overrideable via env (`SESSION_COOKIE_NAME`) so `__Host-` prefix cannot be assumed. `Secure` flag only set when `NODE_ENV=production` — devs testing over LAN via HTTP still leak cookies to sniffers.
- Fix: force cookie name `__Host-careeros_session` when TLS, drop the env override; drop the `SESSION_COOKIE_NAME` env entirely (YAGNI).

### M2. `GET /setup/state` and `POST /setup/account` are unauthenticated by design — enumeration
- Category: 1 (AuthN)
- File: `apps/api/src/modules/setup/setup.controller.ts:40-56`
- What's wrong: `GET /setup/state` reveals whether any user exists (`hasUser` field). `POST /setup/account` only guards on `userCount() > 0`. Race between two concurrent POSTs both seeing `count=0` will allow two account creations. Also acceptable since `email` is `@unique` will hard-fail one, but Prisma throws a P2002 that leaks the email exists.
- Fix: wrap in a Postgres advisory lock (`SELECT pg_advisory_xact_lock(1)`); return generic `409 Conflict` on P2002; keep `GET /setup/state` unauthed only for the wizard's first call.

### M3. `queryRawUnsafe` in stats/timeseries uses interpolated `tz` and `bucket` — parametrised, but string-concat feels fragile
- Category: 4 (Injection)
- File: `apps/api/src/modules/stats/stats.service.ts:99-107`, `apps/api/src/modules/usage/usage.service.ts:209-230`, `apps/api/src/modules/assessments/assessments.service.ts:443-451`
- What's wrong: values are passed as `$1/$2/$3` bind parameters (safe), and the `tz` string is whitelisted via `Intl.supportedValuesOf('timeZone')` at `stats.service.ts:7`. **Usage/timeseries `bucket` is NOT whitelisted** — controller checks `bucket === 'hour' || bucket === 'day'` (`usage.controller.ts:59`) so it is safe today, but the raw SQL path in `usage.service.ts:209` accepts `bucket` as `$1` for `date_trunc()` which is a SQL keyword and Postgres will silently accept anything with `date_trunc('bogus', ts)` → runtime error. Not exploitable, but hardening opportunity.
- Fix: switch to `Prisma.sql` template + `Prisma.raw` for the constant; or move the enum to `packages/shared`.

### M4. LLM audit + hallucination logs may include full untrusted content — sensitive log surface
- Category: 3 (LLM safety) / 2 (Secrets)
- File: `apps/api/src/common/llm-audit.ts` (implied), `apps/api/src/common/hallucination-log.ts`, `apps/api/src/modules/resume/resume.service.ts:117-124`
- What's wrong: hallucination logger receives `result` + full `text` (`resume.service.ts:117`) and writes to `llm_hallucination_log`. Resume text is `personal` sensitivity and is now persisted in a log table for the "eval loop". No retention policy, no encryption on the log column. Same class of leak as saving raw prompts.
- Fix: mark `llm_hallucination_log.snippet` as encrypted via `ENCRYPTED_FIELDS` in `prisma.service.ts:23`; add 30-day retention; log only the hashed suspect fragment plus its offset, not the full body.

### M5. MinIO uses default access keys, no per-user bucket policy
- Category: 8 (Upload/MinIO)
- File: `apps/api/src/common/storage.service.ts:14-21`, `docker-compose.yml:78-79`
- What's wrong: `storage.service.ts:18-19` falls back to `'careeros'` / `'careerosminio'` if env unset. Uploads land under `resumes/<userId>/` with no ACL — any process with MinIO creds can list everything. `putObject` writes the original mimetype from the client (`resume.service.ts` passes `file.mimetype` from multer without re-verifying via magic bytes). A user uploading `application/pdf` labelled DOCX will be stored as PDF.
- Fix: remove default keys; verify magic bytes server-side (first 4 bytes of PDF = `%PDF`, DOCX = `PK\x03\x04`); use per-user MinIO signed URLs.

### M6. Setup wizard writes global `app_config.sensitivity_policy` from any authenticated user
- Category: 1 (AuthN — future multi-tenant risk)
- File: `apps/api/src/modules/usage/usage.controller.ts:107-136`
- What's wrong: `POST /me/usage/pause`, `/me/usage/budget`, `/me/usage/sensitivity` mutate global `AppConfig` rows shared across users (`sensitivity-gate.service.ts:60-68`). Fine for single-user MVP, but the route is under `/me/*` implying per-user. Any future multi-tenant flip = privilege escalation.
- Fix: add a `TODO(multitenant):` comment + `assert userCount() === 1` guard, or scope AppConfig by userId.

### M7. Docker images tagged `:latest` / floating minor — no digest pinning
- Category: 11 (Docker/infra)
- File: `infra/docker/docker-compose.yml:5,23,36,49`
- What's wrong: `postgres:16-alpine`, `redis:7-alpine`, `qdrant/qdrant:v1.12.4` (pinned), `quay.io/minio/minio:latest` (**floating**). Spec item 10 requires digest pinning.
- Fix: replace with `image: postgres:16-alpine@sha256:…`, same for redis + minio.

### M8. Web `middleware.ts` open-fails to `NextResponse.next()` when API is down
- Category: 1 (AuthN) — low today, matters when auth adds gating
- File: `apps/web/src/middleware.ts:26-28`
- What's wrong: on API fetch failure the middleware currently allows through — acceptable now because pages themselves are gated by the API cookie, but if a future page renders server-side content without re-checking, an attacker who blocks the API request (blackhole `api:3001`) bypasses setup gating.
- Fix: return `NextResponse.redirect('/service-unavailable')` on network error; explicit deny-fail.

### M9. Assessments/CorpusService/JobsService/etc. all re-read the secret and decrypt inline — no rate limit per user on LLM calls
- Category: 7 (rate limit)
- File: `apps/api/src/modules/usage/usage.service.ts` (assertCallAllowed only checks budget), all `tryLoadProvider` callers
- What's wrong: `assertCallAllowed` gates on paused/budget only. No per-user cap on parallel LLM calls, no per-endpoint burst. A user can trigger `POST /me/resume-variants/for-job/:jobId` in a tight loop and spend the entire monthly budget in seconds.
- Fix: BullMQ concurrency limit per user (already single-user); short-term add `p-limit(2)` per user, per LLM call site.

---

## LOW

### L1. Error responses can leak internal messages (deepseek upstream error strings)
- Category: 3 (LLM safety)
- File: `packages/ai/src/providers/deepseek.ts:231` — `throw new Error(json.error?.message ?? HTTP ${res.status})` propagates to caller.
- Fix: wrap in `throw new Error('LLM provider error')`; log the raw message server-side only.

### L2. `email.toLowerCase()` used for lookup — Unicode case folding not normalised
- Category: 1 (AuthN)
- File: `apps/api/src/modules/auth/auth.service.ts:14,24`
- Fix: `email.normalize('NFC').toLowerCase()`; matters for i18n edge cases (Turkish dotless i).

---

## Hardening opportunities (theoretical / spec-gap, no runnable exploit found)

- **CSP nonce**: helmet uses `default-src 'self'` + `'unsafe-inline'` in `style-src`. Move to nonce-based for Next 15 (spec item 2).
- **Passkey / WebAuthn**: security.md item 3 requires `@simplewebauthn/server` — no such dep. Zero passkey code.
- **PII field encryption coverage**: only `ResumeFact.content` is in `ENCRYPTED_FIELDS` (`prisma.service.ts:23`). Spec item 5 requires `career_goals`, `evidence(type in self,document)`, `applications`, `outreach_messages`. Only ResumeFact done.
- **Backups**: no `scripts/backup.sh`, no age-encrypt, no CI restore test (spec item 8 — not implemented).
- **Release chain**: no `SECURITY.md`, no cosign, no SBOM, no `SHA256SUMS` (spec item 9 — not implemented).
- **Vulnerability CI**: no `pnpm audit`, no CodeQL, no Trivy, no Renovate (spec item 10 — not implemented).
- **Container hardening**: dev-oriented `node:20-alpine`, runs as root, no read-only rootfs, no cap-drop (spec item 10 checklist).
- **Playwright agent allowlist**: `packages/browser-agent` does not exist — nothing to audit yet.
- **Grounded-generation contract** (ai-safety item 1): `packages/ai/grounded.ts` exists — spot-check it if the fact-ref enforcement matters for the current phase; not part of this pass.
- **Prompt registry**: `packages/ai/src/prompts/` present with `registry.ts` — hash-logged, versioned. Untrusted-content wrap (`wrap.ts`) is solid (NFKC + zero-width strip + case-insensitive close-tag escape).
- **Sensitivity gate**: `sensitivity-gate.service.ts` well implemented; default fail-closed, opt-in per provider. Good.
- **IDOR**: all `getById(userId, id)` calls use `findFirst({ where: { id, userId } })` — spot-check passed across applications, resume-variants, cover-letters, facts.
- **Raw SQL**: every `$queryRaw`/`$queryRawUnsafe` uses bind parameters; whitelisted enums for `tz`, `bucket`. No injection surface today.
- **XSS**: no `dangerouslySetInnerHTML` in `apps/web/src`; React auto-escapes.

## Top three to fix first

1. **C1** — ship `@nestjs/throttler` + Redis storage today; wrap `/auth/*`, `/setup/account`, `/me/usage/*` with strict limits. Trivial diff, blocks the loudest attack.
2. **C2** — allow-list `baseUrl` hostnames and refuse RFC1918 targets. Ten lines in `ProviderConfigSchema` + a `assertPublicUrl(url)` helper reused by embedding config.
3. **H1 + H2** — CSRF (`csrf-csrf` or `Sec-Fetch-Site` check) and helmet full-set headers in `main.ts`. Both are one-file diffs and directly satisfy security.md item 2.

Everything else can climb the ladder once these three land.
