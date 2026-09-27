# Career OS — Observability Spec

Cross-cutting spec for logs, metrics, errors, and traces. What we run, where it lives, what operators see.

**Target:** the operator can answer "is the app healthy, what broke, and why" without shelling into containers. Zero telemetry leaves the box except to services the operator configured.

---

## Stack (locked)

| Concern | Choice | Why |
|---|---|---|
| Logs | `pino` (JSON in prod, pretty in dev) → stdout → Docker `json-file` driver | Fast, structured, works with any log shipper. No lock-in. |
| Metrics | `prom-client` (Prometheus format) → `/metrics` endpoint on api + worker | Class standard (Cal.com, Immich, Grafana OSS use this). Operators can add their own Prometheus/Grafana. |
| Error tracking | Self-hosted **GlitchTip** (Sentry-compatible, MIT) as compose service | No vendor phone-home. Sentry SDK works against it unchanged. |
| Tracing | **Not in MVP.** Interface reserved. | OpenTelemetry adds real complexity; single-user tool rarely needs distributed traces. Add if we ever need it. |
| Uptime | External responsibility (operator uses UptimeRobot / Kuma / whatever) | Self-monitoring is a smell |

---

## Logging conventions

### Format

- **Production:** JSON per line via `pino`
- **Development:** `pino-pretty` colorized
- **Never:** `console.log` in application code (ESLint rule blocks it)

### Every log entry carries

- `level` (trace/debug/info/warn/error/fatal)
- `time` (ISO 8601 UTC)
- `msg` (human-readable summary)
- `context` — structured payload; keys are stable across the codebase:
  - `user_id` (never username — IDs only)
  - `request_id` (from `X-Request-ID` header, generated if absent)
  - `agent_role` (when inside an LLM agent call)
  - `prompt_id` + `prompt_hash` (LLM calls)
  - `provider` + `model` (LLM/external calls)
  - `job_id` (BullMQ jobs)
  - `duration_ms`

### Redaction

- `packages/shared/redact.ts` — regex + key-based redaction pass runs before every log write via `pino.transport`
- Redacts: known secret env keys, `Authorization`, `Cookie`, `api_key`, `token`, `password`, `refresh_token`, `client_secret`, AWS-style access keys
- CI test: seed a log with each pattern → assert redaction covers all

### Log levels — when to use

- `fatal` — process exiting
- `error` — request failed, retry exhausted, LLM validation failed after retry, backup failed
- `warn` — retry attempt, provider fallback triggered, injection detected, budget exceeded
- `info` — request received (with method + path + status + duration), setup step completed, job enqueued/completed
- `debug` — enabled per-module via `LOG_DEBUG=ai,queue,sensitivity` env
- `trace` — never in production

### Retention & rotation

- Docker `json-file` log driver with `max-size=10m` and `max-file=5` per container
- Operators can ship logs anywhere via standard Docker log drivers (documented in `docs/logging.md`)

---

## Metrics

### Endpoint

- `GET /metrics` on api + worker (private port, not exposed publicly)
- Prometheus scrape-compatible

### Metric taxonomy

**HTTP:**
- `http_requests_total{method,route,status}` — counter
- `http_request_duration_seconds{method,route}` — histogram (p50/p95/p99)
- `http_requests_in_flight` — gauge

**Auth:**
- `auth_login_total{result}` — counter (success/failure/locked)
- `auth_active_sessions` — gauge

**Queues:**
- `queue_jobs_total{queue,status}` — counter (completed/failed/stalled)
- `queue_job_duration_seconds{queue}` — histogram
- `queue_depth{queue}` — gauge

**LLM (from `llm_calls` middleware):**
- `llm_calls_total{provider,model,prompt_id,sensitivity,result}` — counter
- `llm_input_tokens_total{provider,model}` — counter
- `llm_output_tokens_total{provider,model}` — counter
- `llm_cost_usd_total{provider,model}` — counter
- `llm_call_duration_seconds{provider,model}` — histogram
- `llm_cache_hits_total{prompt_id}` — counter
- `llm_validation_failures_total{prompt_id}` — counter
- `llm_injection_flags_total{source_kind}` — counter
- `llm_hallucination_flags_total{prompt_id}` — counter

**Job pipeline (P3):**
- `jobs_ingested_total{source}` — counter
- `jobs_rejected_total{stage,reason}` — counter
- `jobs_verified_total{source,state}` — counter

**Agent (P3.5):**
- `agent_tasks_total{task_type,result}` — counter
- `agent_devices_online` — gauge

**System:**
- Default Node.js metrics (heap, event loop lag, GC) via `prom-client`
- `db_pool_connections{state}` — gauge (idle/active/waiting)

### Alerting (operator-configured)

- Not part of this repo. `metrics.md` documents which metrics matter for alerts.
- Ship-recommended alert set as example `alertmanager.yml` in `docs/observability/`.

---

## Error tracking

### GlitchTip

- Compose service in `infra/docker/docker-compose.yml`
- Backed by same Postgres (separate schema) + Redis
- Web UI on internal port; behind nginx auth for public exposure (optional)
- DSN passed to api + worker via env

### Sentry SDK integration (works against GlitchTip)

- `@sentry/node` in api + worker
- `@sentry/nextjs` in web
- Sample rate: 100% for errors, 10% for performance transactions
- **PII scrubbing:** `beforeSend` hook runs `packages/shared/redact.ts`
- Release tag: git SHA baked at build time via `SENTRY_RELEASE`
- Source maps uploaded on build

### What we DON'T send

- No breadcrumbs containing user PII
- No form values
- No LLM prompt bodies (only `prompt_id` + `prompt_hash`)
- No secret env values (redaction pass covers)

---

## Tracing (deferred)

- Interface stub: `packages/shared/trace.ts` — no-op default, OpenTelemetry adapter possible later
- Reason for deferral: distributed traces add real cost + complexity; single-user tool with a small handful of services can debug via logs + metrics for years
- Signal to reconsider: > 3 request-hops across services routinely, or > 1 sec p95 latency with unclear breakdown

---

## Health endpoint

`GET /health` returns:

```json
{
  "status": "ok" | "degraded" | "down",
  "version": "1.2.3",
  "uptime_s": 12345,
  "checks": {
    "postgres":  { "ok": true, "latency_ms": 3 },
    "redis":     { "ok": true, "latency_ms": 1 },
    "qdrant":    { "ok": true, "latency_ms": 8 },
    "minio":     { "ok": true, "latency_ms": 5 },
    "ai_default": { "ok": true, "latency_ms": 220, "provider": "deepseek" },
    "embedding": { "ok": true, "latency_ms": 40 }
  }
}
```

- Fast path: all checks parallel with 500ms timeout each
- Cached 5s to prevent probe abuse
- Publicly reachable (no auth); returns 503 on degraded/down

---

## Operator setup

Documented in `docs/observability.md`:

1. Where the `/metrics` endpoints live and how to scrape them
2. Docker log-driver config for shipping to external log store
3. GlitchTip UI URL + how to set the retention
4. Recommended dashboards (Grafana JSON committed to `docs/observability/dashboards/`)
5. Recommended alerts (Alertmanager YAML committed)

## Phase coverage

| Phase | Observability landing |
|---|---|
| P0 | pino setup, redaction, `/metrics` endpoint scaffold, GlitchTip in compose, health endpoint, request-id middleware |
| P1 | LLM + queue metrics wired (from ai-safety Item 9 middleware), skill-graph domain events |
| P3 | job-pipeline metrics, source-adapter counters |
| P3.5 | agent metrics + audit-log events |
| P5 | Slack/Gmail integration metrics |
| P6 | Advanced dashboards + example alert rules in `docs/` |
