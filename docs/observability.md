# Observability — operator guide

How to see what Career OS is doing: logs, metrics, errors, and health. Spec:
[`plan/observability.md`](../plan/observability.md). Nothing here sends data
off-box unless you configure it.

---

## 1. Logs

- api + worker log `pino` JSON to stdout; dev uses `pino-pretty`.
- Docker `json-file` driver caps each container at `max-size=10m`, `max-file=5`
  (50 MB/container) — see `x-logging` in
  [`infra/docker/docker-compose.yml`](../infra/docker/docker-compose.yml).
- Tail: `pnpm docker:logs` or
  `docker compose --env-file .env -f infra/docker/docker-compose.yml logs -f api worker`.
- Secrets are redacted twice: pino's `redact` paths and
  [`packages/shared/redact.ts`](../packages/shared/src/redact.ts). The same
  redactor scrubs error events before they leave the process.

## 2. Metrics

- Prometheus format at `GET /metrics` on api + worker (private network only).
- Scrape from inside the network, e.g.
  `docker compose exec api wget -qO- http://localhost:3001/metrics`.
- Metric taxonomy (HTTP, auth, queues, LLM, jobs, agent, system) is listed in
  `plan/observability.md` §Metrics. Alerting is operator-configured.

## 3. Error tracking — self-hosted GlitchTip

GlitchTip is Sentry-compatible, so the apps use the stock `@sentry/node` SDK.

### Start it

```bash
# 1. Put a secret in .env (REQUIRED; GlitchTip refuses to boot without it)
openssl rand -hex 48            # -> GLITCHTIP_SECRET_KEY
# 2. Bring up the service (own DB `glitchtip` on the shared Postgres, Redis DB 1)
docker compose --env-file .env -f infra/docker/docker-compose.yml \
  --profile observability up -d glitchtip
```

The service is profile-gated (`ops` / `observability`) and lives on the
`internal` network only. It needs its own Postgres database; `init.sql` creates
`glitchtip` on a fresh volume. On an existing volume create it once:

```bash
docker compose exec postgres createdb -U "$POSTGRES_USER" glitchtip
```

To open the UI, add an nginx server block that proxies to `glitchtip:8000`, or
use a one-off port-forward:

```bash
docker compose --profile observability run --rm --service-ports glitchtip
# browse http://localhost:8000, register the first user, create a project
```

### Wire the apps

1. Create an organization + project in the UI.
2. Copy the DSN from **Settings → Client Keys**.
3. Put it in `.env` as `SENTRY_DSN` (or `GLITCHTIP_DSN`) and restart api +
   worker.

### Behaviour

- **No DSN = no-op.** `initSentry()` returns false and boot continues exactly as
  before. Nothing is sent, no SDK network calls are made.
- **`beforeSend` scrubs everything** through `packages/shared/redact`, then
  deletes `event.user` and `event.request`. `sendDefaultPii: false`,
  `maxBreadcrumbs: 0`, and `beforeBreadcrumb: () => null` mean no form values,
  cookies, headers, or breadcrumb trail ship.
- **Release tag = git SHA.** `resolveSentryRelease()` reads `SENTRY_RELEASE`,
  then `GIT_SHA` (baked at image build by CI, see the `ARG GIT_SHA` in
  `infra/docker/Dockerfile.api` / `Dockerfile.worker`), then `GITHUB_SHA` /
  `SOURCE_VERSION`.
- **Sampling:** 100% errors, 10% transactions (`tracesSampleRate: 0.1`).
- **Retention:** `GLITCHTIP_RETENTION_DAYS` (default 90); override per class with
  `GLITCHTIP_EVENT_RETENTION_DAYS` / `GLITCHTIP_TRANSACTION_RETENTION_DAYS`.
- **Email:** `EMAIL_URL=consolemail://` by default (mail is logged). Set an SMTP
  URL to receive alerts.

### Web (follow-up)

`apps/web` is not yet instrumented. `@sentry/nextjs` 11 supports Next 16, so the
remaining work is mechanical and must be done by the web owner:

1. `pnpm --filter @careeros/web add @sentry/nextjs`
2. Add `apps/web/instrumentation.ts` (`register()` calls `Sentry.init` for the
   node runtime and `onRequestError = Sentry.captureRequestError`) and
   `apps/web/instrumentation-client.ts` for the browser, using the same
   `beforeSend: (e) => redact(stripPii(e))` redaction.
3. Read `NEXT_PUBLIC_SENTRY_DSN` (compose already forwards it from `SENTRY_DSN`).

Until then the web env vars are inert.

## 4. Health

`GET /health` on the api returns per-dependency checks (Postgres, Redis, Qdrant,
MinIO, AI) and 503 when degraded. Whisper is not part of the api health payload;
probe it directly via the `@careeros/stt` client (`GET /health` → `{"status":"ok"}`).
