import { describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';
import { HttpMetricsMiddleware } from './http-metrics.middleware';
import { MetricsService } from './metrics.service';

interface FakeRes extends Partial<Response> {
  emitFinish: () => void;
}

function fakeRes(statusCode: number): FakeRes {
  let cb: (() => void) | null = null;
  return {
    statusCode,
    on: (event: string, fn: () => void) => {
      if (event === 'finish') cb = fn;
      return fakeRes as unknown as Response;
    },
    emitFinish: () => cb?.(),
  } as unknown as FakeRes;
}

describe('HttpMetricsMiddleware', () => {
  it('records request count with matched-route label + duration histogram', async () => {
    const svc = new MetricsService();
    const mw = new HttpMetricsMiddleware(svc);

    const req = {
      method: 'GET',
      originalUrl: '/users/42',
      url: '/users/42',
      route: { path: '/users/:id' },
      baseUrl: '',
    } as unknown as Request;
    const res = fakeRes(200);

    let nextCalled = false;
    mw.use(req, res as unknown as Response, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);

    // Simulate response completion.
    res.emitFinish();

    const text = await svc.render();
    expect(text).toContain(
      'careeros_http_requests_total{method="GET",route="/users/:id",status="200"} 1',
    );
    expect(text).toContain('careeros_http_request_duration_seconds_count{method="GET",route="/users/:id"} 1');
  });

  it('falls back to sanitised URL when Express has no matched route', async () => {
    const svc = new MetricsService();
    const mw = new HttpMetricsMiddleware(svc);

    const req = {
      method: 'POST',
      originalUrl: '/does-not-exist?foo=bar',
      url: '/does-not-exist?foo=bar',
    } as unknown as Request;
    const res = fakeRes(404);

    mw.use(req, res as unknown as Response, () => {});
    res.emitFinish();

    const text = await svc.render();
    // Query string stripped; path preserved.
    expect(text).toContain(
      'careeros_http_requests_total{method="POST",route="/does-not-exist",status="404"} 1',
    );
  });

  it('captures 500s so error rate can be graphed from the same counter', async () => {
    const svc = new MetricsService();
    const mw = new HttpMetricsMiddleware(svc);

    const req = {
      method: 'GET',
      originalUrl: '/broken',
      url: '/broken',
      route: { path: '/broken' },
    } as unknown as Request;
    const res = fakeRes(500);

    mw.use(req, res as unknown as Response, () => {});
    res.emitFinish();

    const text = await svc.render();
    expect(text).toContain(
      'careeros_http_requests_total{method="GET",route="/broken",status="500"} 1',
    );
  });
});
