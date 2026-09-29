# Threat model - operator view

The person running Career OS on their own VPS. This document exists
so you can decide what NOT to worry about vs what you MUST get right.

## Actors

| Actor | Motivation | Access |
|---|---|---|
| **Operator (you)** | Run the tool | Root on the host, admin in the app |
| **Legitimate user** | Use the tool | Session cookie |
| **Attacker (external)** | Exfiltrate secrets / hijack account / pivot | Network only |
| **Attacker (LLM provider)** | Model output tampering, prompt exfiltration | Chat/completion API |
| **Attacker (GitHub / GitLab)** | Ingest-side poison | Repository content the ingest reads |
| **Attacker (email sender)** | Injection via alert emails | Message body in the ingest pipeline |
| **Compromised desktop agent** | Local device compromise | Agent JWT (short-lived) |

## Assets

- Encrypted secrets: LLM API keys, GitHub PAT, GitLab PAT, Gmail
  OAuth refresh token, Slack bot token. All AES-256-GCM with the
  purpose bound as AAD.
- Session data: sealed iron-session cookie + `active_sessions` row.
- Personal data: resume, career goals, evidence graph, application
  history, LLM call logs, hallucination logs.
- Audit log: append-only, DDL-granted `INSERT`-only to the app role.

## Trust boundaries

```
Internet
  |
  v
[ nginx TLS (operator-run) ]
  |
  v
[ apps/api ] -- SessionService --+
  |                              |
  |                              v
  |         [ Postgres ]  [ Redis ]  [ MinIO (per-user signed URLs) ]
  |
  v
[ Squid proxy (egress) ]
  |
  v
[ LLM provider | GitHub | GitLab | Google (Gmail Pub/Sub + OAuth) | Slack ]
```

Egress goes THROUGH Squid; the `internal` network cannot reach the
public Internet. This is why the `assertPublicUrl` SSRF gate refuses
RFC1918/link-local/loopback URLs even from authenticated users.

## In-scope threats + mitigations

| Threat | Mitigation |
|---|---|
| Credential stuffing | Exponential lockout, `@nestjs/throttler`, passkey preferred |
| Session hijack | Sealed `__Host-` cookie, `SameSite=Strict`, CSRF double-submit, `Sec-Fetch-Site` |
| CSRF on state changes | Double-submit HMAC token echoed via fetch wrapper |
| XSS | Strict CSP (nonce-based; no `unsafe-inline` on `script-src`), sanitised markdown, escape at render |
| Clickjacking | `frame-ancestors 'none'` + `X-Frame-Options DENY` |
| Directory traversal | No user-supplied file paths; MinIO signed URLs scoped per user |
| SSRF via user URL | `assertPublicUrl` allowlist + DNS-resolve + RFC1918 check |
| Injection into LLM prompts | `wrapUntrusted('email' \| 'user-input' \| ...)` + `injection-scan` before every call |
| Model hallucination | Fact-check gate on resume, cover-letter, dossier, interview prep, outreach |
| Data exfiltration by LLM provider | Sensitivity gate per provider ceiling (block \| local-only \| public \| personal \| confidential \| employer-confidential) |
| Runaway LLM cost | Per-user monthly budget cap + `assertCallAllowed` gate + `p-limit(2)` per-user concurrency |
| Backup exfiltration | `age` encryption of nightly dumps (see `docs/backup.md`) |
| Audit-log tampering | DDL grant excludes UPDATE/DELETE for the app role; retention worker respects the grant |
| Desktop agent compromise | JWT scope pinned to `agent:*`, refresh rotation on every use, pairing throttled 5/hr per IP, kill-switch in tray |

## Out-of-scope threats

These are not defended against in the current shipped code; the
operator carries the risk.

- Host-level compromise (root on the VPS). Nothing at the app layer
  can help.
- Physical device compromise (laptop stolen with active session).
  Mitigation: enable passkey + short session TTL + operator-side
  disk encryption.
- Malicious operator (you). No zero-trust model against yourself.
- Supply-chain attack via a compromised dep. Weekly Renovate PRs +
  `pnpm audit` are the current speed bump; SBOM + cosign
  verification (per `docs/verify.md`) closes it further.

## Blast-radius bounding

If an admin session is compromised:
- Attacker can read all data (personal, encrypted secrets stay
  ciphertext but their round-trip is available via `POST /me/export`).
- Attacker CAN'T bypass the approval queue for outbound actions
  (approval requires fresh re-auth < 5 min).
- Attacker CAN'T change encryption keys (`MASTER_KEY` is env-only,
  not stored in the app).

## Change-review triggers

Anything touching one of these files requires an explicit
`security-review` on the PR:

- `apps/api/src/modules/auth/**`
- `apps/api/src/main.ts` (helmet + CSP + middleware)
- `packages/secrets/**`
- `packages/shared/src/net/**` (SSRF gate)
- `packages/ai/src/wrap.ts` / `injection-scan.ts` /
  `sensitivity-gate.ts`
- `infra/docker/**` (network + Squid + service defaults)
- Any new integration under `apps/api/src/modules/integrations/**`
- Any new webhook or admin route.
