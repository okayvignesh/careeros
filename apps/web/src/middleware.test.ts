import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { middleware } from './middleware';

function req(path: string): NextRequest {
  return new NextRequest(new URL(`http://web${path}`));
}

// The middleware uses AbortController + a 5s timer; drive it with fake timers
// so the timeout test doesn't wait a real 5 seconds.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('middleware — fail closed on API error (A-M8)', () => {
  it('network error on /dashboard redirects to /service-unavailable?next=%2Fdashboard', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const res = await middleware(req('/dashboard'));
    expect(res.status).toBe(307);
    const loc = res.headers.get('location')!;
    const url = new URL(loc);
    expect(url.pathname).toBe('/service-unavailable');
    expect(url.searchParams.get('next')).toBe('/dashboard');
  });

  it('preserves query string in ?next', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    const res = await middleware(req('/jobs?filter=remote'));
    const url = new URL(res.headers.get('location')!);
    expect(url.searchParams.get('next')).toBe('/jobs?filter=remote');
  });

  it('fetch timeout (>5s) redirects to /service-unavailable', async () => {
    vi.useFakeTimers();
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (_url, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          (init.signal as AbortSignal).addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        }),
    );
    const promise = middleware(req('/dashboard'));
    await vi.advanceTimersByTimeAsync(5001);
    const res = await promise;
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/service-unavailable');
  });

  it('non-2xx (502) redirects to /service-unavailable', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('bad gateway', { status: 502 }),
    );
    const res = await middleware(req('/dashboard'));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/service-unavailable');
  });

  it('200 with state=complete passes through', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ state: 'complete' }), { status: 200 }),
    );
    const res = await middleware(req('/dashboard'));
    // NextResponse.next() carries an x-middleware-next: 1 header and 200 status.
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('200 with state=incomplete redirects to /setup/01-preflight', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ state: 'incomplete' }), { status: 200 }),
    );
    const res = await middleware(req('/dashboard'));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/setup/01-preflight');
  });

  it('public route /setup/01-preflight does NOT redirect on API error', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('down'));
    const res = await middleware(req('/setup/01-preflight'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-next')).toBe('1');
    // Should not have even called the API for public routes.
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('public route /sign-in does NOT redirect on API error', async () => {
    const res = await middleware(req('/sign-in'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('/service-unavailable itself does NOT loop-redirect on API error', async () => {
    const res = await middleware(req('/service-unavailable?next=%2Fdashboard'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('logs a distinct code so operators can grep the failure', async () => {
    const spy = vi.spyOn(console, 'error');
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('down'));
    await middleware(req('/dashboard'));
    const firstArg = spy.mock.calls[0]?.[0];
    expect(String(firstArg)).toMatch(/MW_API_UNREACHABLE:/);
  });
});
