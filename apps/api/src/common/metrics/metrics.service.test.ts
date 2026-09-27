import { describe, expect, it } from 'vitest';
import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  it('registers default node metrics and all app counters/histograms', async () => {
    const svc = new MetricsService();
    const text = await svc.render();

    // Default node metrics from prom-client, prefixed via `careeros_`.
    expect(text).toContain('careeros_process_cpu_seconds_total');
    expect(text).toContain('careeros_nodejs_heap_size_total_bytes');

    // Each custom metric name must show up in the exposition. If a name gets
    // renamed accidentally, Prometheus scraping breaks in prod -> assertion
    // goes red first.
    const expected = [
      'careeros_http_requests_total',
      'careeros_http_request_duration_seconds',
      'careeros_llm_calls_total',
      'careeros_llm_tokens_total',
      'careeros_llm_call_duration_seconds',
      'careeros_prisma_queries_total',
      'careeros_prisma_query_duration_seconds',
      'careeros_jobs_processed_total',
      'careeros_audit_events_total',
    ];
    for (const name of expected) {
      expect(text).toContain(name);
    }
  });

  it('increments counters and observes histograms', async () => {
    const svc = new MetricsService();

    svc.httpRequestsTotal.inc({ method: 'GET', route: '/x', status: '200' }, 3);
    svc.httpRequestDurationSeconds.observe({ method: 'GET', route: '/x' }, 0.42);
    svc.llmCallsTotal.inc({ provider: 'deepseek', model: 'chat', ok: 'true' });
    svc.llmTokensTotal.inc(
      { provider: 'deepseek', model: 'chat', kind: 'input' },
      500,
    );
    svc.llmCallDurationSeconds.observe({ provider: 'deepseek', model: 'chat' }, 1.5);
    svc.prismaQueriesTotal.inc({ model: 'User', op: 'findMany', ok: 'true' });
    svc.prismaQueryDurationSeconds.observe({ model: 'User', op: 'findMany' }, 0.01);
    svc.jobsProcessedTotal.inc({ queue: 'jobs', status: 'completed' });
    svc.auditEventsTotal.inc({ action: 'auth.sign_in' });

    const text = await svc.render();

    expect(text).toMatch(/careeros_http_requests_total\{method="GET",route="\/x",status="200"\}\s+3/);
    expect(text).toMatch(/careeros_llm_tokens_total\{provider="deepseek",model="chat",kind="input"\}\s+500/);
    expect(text).toContain('careeros_llm_call_duration_seconds_bucket');
    expect(text).toContain('careeros_audit_events_total{action="auth.sign_in"} 1');
  });

  it('exposes a JSON dump for the ?format=json humans path', async () => {
    const svc = new MetricsService();
    svc.jobsProcessedTotal.inc({ queue: 'jobs', status: 'failed' }, 2);

    const json = (await svc.renderJson()) as Array<{ name: string; values: unknown[] }>;
    const job = json.find((m) => m.name === 'careeros_jobs_processed_total');
    expect(job).toBeDefined();
    expect(job!.values.length).toBeGreaterThan(0);
  });
});
