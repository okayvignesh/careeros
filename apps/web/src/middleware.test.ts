import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { middleware } from './middleware';

function req(path: string): NextRequest {
  return new NextRequest(new URL(`http://web${path}`));
}

interface StateBody {
  state: string;
  hasUser: boolean;
  currentStepSlug: string | null;
  allowedSlugs: readonly string[];
}

function stateResponse(body: StateBody): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function mockState(body: StateBody): void {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(stateResponse(body));
}

const stateMidflight: StateBody = {
  state: 'embedding_configured',
  hasUser: true,
  currentStepSlug: '06-embedding-test',
  allowedSlugs: [
    '01-preflight',
    '02-account',
    '03-provider',
    '04-capability',
    '05-embedding',
    '06-embedding-test',
  ],
};

const stateComplete: StateBody = {
  state: 'complete',
  hasUser: true,
  currentStepSlug: null,
  allowedSlugs: [],
};

const stateFresh: StateBody = {
  state: 'not_started',
  hasUser: false,
  currentStepSlug: '01-preflight',
  allowedSlugs: ['01-preflight'],
};

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

  it('framework path /_next/... skips the API call entirely', async () => {
    const res = await middleware(req('/_next/static/chunk.js'));
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

describe('middleware — setup complete', () => {
  it('/dashboard renders when setup complete', async () => {
    mockState(stateComplete);
    const res = await middleware(req('/dashboard'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('/sign-in redirects to /dashboard when setup complete (login-persistence)', async () => {
    mockState(stateComplete);
    const res = await middleware(req('/sign-in'));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/dashboard');
  });

  it('/setup/03-provider redirects to /dashboard when setup complete', async () => {
    mockState(stateComplete);
    const res = await middleware(req('/setup/03-provider'));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/dashboard');
  });

  it('/setup (no slug) redirects to /dashboard when setup complete', async () => {
    mockState(stateComplete);
    const res = await middleware(req('/setup'));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/dashboard');
  });
});

describe('middleware — URL-jump prevention', () => {
  it('URL-jump to /setup/14-complete when on step 6 → 307 back to current step', async () => {
    mockState(stateMidflight);
    const res = await middleware(req('/setup/14-complete'));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/setup/06-embedding-test');
  });

  it('URL-jump to /setup/09-resume when on step 6 → 307 back to current step', async () => {
    mockState(stateMidflight);
    const res = await middleware(req('/setup/09-resume'));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/setup/06-embedding-test');
  });

  it('URL-jump to a nonexistent slug also redirects (fail closed)', async () => {
    mockState(stateMidflight);
    const res = await middleware(req('/setup/99-nope'));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/setup/06-embedding-test');
  });

  it('an allowed earlier step (edit answers) passes through', async () => {
    mockState(stateMidflight);
    const res = await middleware(req('/setup/03-provider'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('the current step passes through', async () => {
    mockState(stateMidflight);
    const res = await middleware(req('/setup/06-embedding-test'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('/dashboard while setup incomplete → redirect to current step (not preflight)', async () => {
    mockState(stateMidflight);
    const res = await middleware(req('/dashboard'));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/setup/06-embedding-test');
  });

  it('fresh install: /dashboard → redirect to /setup/01-preflight', async () => {
    mockState(stateFresh);
    const res = await middleware(req('/dashboard'));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/setup/01-preflight');
  });

  it('fresh install: /setup/02-account (not yet allowed) → redirect to /setup/01-preflight', async () => {
    mockState(stateFresh);
    const res = await middleware(req('/setup/02-account'));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/setup/01-preflight');
  });

  it('/sign-in stays reachable while setup incomplete (recovery path)', async () => {
    mockState(stateMidflight);
    const res = await middleware(req('/sign-in'));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });
});
