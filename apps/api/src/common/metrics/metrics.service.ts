import { Injectable } from '@nestjs/common';
import {
  collectDefaultMetrics,
  Counter,
  Histogram,
  Registry,
} from 'prom-client';

/**
 * C-P4.8: single Prometheus registry for the api process.
 *
 * All metric objects live on this service so tests can inject a fresh registry
 * per test (via `new MetricsService()`) instead of poisoning the singleton
 * `prom-client` global registry. Nest treats this @Injectable() as a singleton
 * in prod, so operators scrape one canonical set of counters/histograms.
 *
 * Metric names follow the plan/observability.md taxonomy, prefixed `careeros_`
 * so they never collide with a sidecar node_exporter's default metrics.
 *
 * ponytail: histogram buckets are the prom-client defaults for HTTP + a
 * seconds-scale set for LLM/Prisma. Tune once we have a month of production
 * data; guessing now would just be different guessing.
 */
@Injectable()
export class MetricsService {
  readonly registry: Registry;

  readonly httpRequestsTotal: Counter<string>;
  readonly httpRequestDurationSeconds: Histogram<string>;

  readonly llmCallsTotal: Counter<string>;
  readonly llmTokensTotal: Counter<string>;
  readonly llmCallDurationSeconds: Histogram<string>;

  readonly prismaQueriesTotal: Counter<string>;
  readonly prismaQueryDurationSeconds: Histogram<string>;

  readonly jobsProcessedTotal: Counter<string>;
  readonly auditEventsTotal: Counter<string>;
  /** Audit rows lost to queue overflow or a DB write failure (item 9). */
  readonly llmAuditDroppedTotal: Counter<string>;
  /** Injection flags persisted to `llm_injection_log` (item 5). */
  readonly llmInjectionFlagsTotal: Counter<string>;
  /** Injection-log rows that could not be persisted. */
  readonly injectionLogDroppedTotal: Counter<string>;

  constructor() {
    this.registry = new Registry();

    // Node runtime: heap, event-loop lag, GC, CPU. Free from prom-client;
    // operators expect these on any /metrics endpoint.
    collectDefaultMetrics({ register: this.registry, prefix: 'careeros_' });

    this.httpRequestsTotal = new Counter({
      name: 'careeros_http_requests_total',
      help: 'HTTP requests handled, labelled by method/route/status.',
      labelNames: ['method', 'route', 'status'],
      registers: [this.registry],
    });

    this.httpRequestDurationSeconds = new Histogram({
      name: 'careeros_http_request_duration_seconds',
      help: 'HTTP request duration in seconds.',
      labelNames: ['method', 'route'],
      // Web-request buckets: 5ms .. 10s. Same shape prom-client suggests
      // for HTTP; keeps p50/p95/p99 quantile estimation cheap.
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });

    this.llmCallsTotal = new Counter({
      name: 'careeros_llm_calls_total',
      help: 'LLM provider calls, labelled by provider/model/ok.',
      labelNames: ['provider', 'model', 'ok'],
      registers: [this.registry],
    });

    this.llmTokensTotal = new Counter({
      name: 'careeros_llm_tokens_total',
      help: 'LLM token usage, labelled by provider/model/kind (input|output).',
      labelNames: ['provider', 'model', 'kind'],
      registers: [this.registry],
    });

    this.llmCallDurationSeconds = new Histogram({
      name: 'careeros_llm_call_duration_seconds',
      help: 'LLM provider call duration in seconds.',
      labelNames: ['provider', 'model'],
      // LLM calls are slow; buckets extend to 60s so p95 for the slow tail
      // is not silently clipped to the last bucket.
      buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 30, 60],
      registers: [this.registry],
    });

    this.prismaQueriesTotal = new Counter({
      name: 'careeros_prisma_queries_total',
      help: 'Prisma queries executed, labelled by model/op/ok.',
      labelNames: ['model', 'op', 'ok'],
      registers: [this.registry],
    });

    this.prismaQueryDurationSeconds = new Histogram({
      name: 'careeros_prisma_query_duration_seconds',
      help: 'Prisma query duration in seconds.',
      labelNames: ['model', 'op'],
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });

    this.jobsProcessedTotal = new Counter({
      name: 'careeros_jobs_processed_total',
      help: 'BullMQ jobs processed, labelled by queue/status.',
      labelNames: ['queue', 'status'],
      registers: [this.registry],
    });

    this.auditEventsTotal = new Counter({
      name: 'careeros_audit_events_total',
      help: 'Audit-log events written, labelled by action.',
      labelNames: ['action'],
      registers: [this.registry],
    });

    this.llmAuditDroppedTotal = new Counter({
      name: 'careeros_llm_audit_dropped_total',
      help: 'LLM audit rows dropped, labelled by reason (db_error|queue_full).',
      labelNames: ['reason'],
      registers: [this.registry],
    });

    this.llmInjectionFlagsTotal = new Counter({
      name: 'careeros_llm_injection_flags_total',
      help: 'Injection flags persisted, labelled by severity/action.',
      labelNames: ['severity', 'action'],
      registers: [this.registry],
    });

    this.injectionLogDroppedTotal = new Counter({
      name: 'careeros_injection_log_dropped_total',
      help: 'Injection-log rows dropped before persist.',
      labelNames: ['reason'],
      registers: [this.registry],
    });
  }

  /** Prometheus text exposition; served as-is by the /metrics controller. */
  async render(): Promise<string> {
    return this.registry.metrics();
  }

  /** Human-friendly JSON dump for `?format=json`. */
  async renderJson(): Promise<unknown> {
    return this.registry.getMetricsAsJSON();
  }
}
