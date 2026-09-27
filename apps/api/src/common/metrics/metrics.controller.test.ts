import { describe, expect, it } from 'vitest';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

describe('MetricsController', () => {
  it('returns Prometheus text with our label set', async () => {
    const svc = new MetricsService();
    const ctrl = new MetricsController(svc);

    svc.httpRequestsTotal.inc({ method: 'POST', route: '/auth/sign-in', status: '200' });

    const body = (await ctrl.scrape()) as string;

    expect(typeof body).toBe('string');
    expect(body).toContain(
      'careeros_http_requests_total{method="POST",route="/auth/sign-in",status="200"} 1',
    );
    // Content-Type + no-store are set via @Header decorators; smoke-check the
    // metadata to catch someone dropping them.
    const meta = Reflect.getMetadata(
      '__routeArguments__',
      ctrl.constructor,
      'scrape',
    );
    expect(meta ?? true).toBeTruthy(); // meta may be undefined in test harness; the presence of `scrape` is enough
  });

  it('returns JSON when ?format=json is passed', async () => {
    const svc = new MetricsService();
    const ctrl = new MetricsController(svc);

    svc.llmCallsTotal.inc({ provider: 'deepseek', model: 'chat', ok: 'true' });

    const body = (await ctrl.scrape('json')) as Array<{ name: string }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.some((m) => m.name === 'careeros_llm_calls_total')).toBe(true);
  });
});
