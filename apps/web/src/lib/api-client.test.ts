import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiGet, apiPost, readCsrfTokenFromCookie } from './api-client';

describe('readCsrfTokenFromCookie', () => {
  it('reads either the __Host- prefixed prod name or the dev name', () => {
    expect(readCsrfTokenFromCookie('__Host-careeros_csrf=abc123; other=x')).toBe('abc123');
    expect(readCsrfTokenFromCookie('other=x; careeros_csrf=dev-token')).toBe('dev-token');
    expect(readCsrfTokenFromCookie('unrelated=1')).toBeNull();
  });
});

describe('api-client CSRF echo (A-H1)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    // Reset document.cookie between tests.
    if (typeof document !== 'undefined') {
      Object.defineProperty(document, 'cookie', {
        configurable: true,
        get: () => '',
        set: () => {},
      });
    }
  });

  function stubFetch(): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(async () =>
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  function setCookie(value: string): void {
    // jsdom-free: fake `document` with the cookie value.
    vi.stubGlobal('document', { cookie: value } as unknown as Document);
  }

  it('sends x-csrf-token header from cookie on POST', async () => {
    setCookie('__Host-careeros_csrf=deadbeef; extra=1');
    const fetchMock = stubFetch();
    await apiPost('/foo', { a: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // MUTATION-SMOKE: delete the `if (method !== 'GET') ...` block from
    // request() and this assertion goes red.
    expect((init.headers as Record<string, string>)['x-csrf-token']).toBe('deadbeef');
  });

  it('does not send x-csrf-token on GET', async () => {
    setCookie('__Host-careeros_csrf=deadbeef');
    const fetchMock = stubFetch();
    await apiGet('/foo');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['x-csrf-token']).toBeUndefined();
  });

  it('omits the header entirely when no CSRF cookie is present', async () => {
    setCookie('unrelated=1');
    const fetchMock = stubFetch();
    await apiPost('/foo');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['x-csrf-token']).toBeUndefined();
  });
});
