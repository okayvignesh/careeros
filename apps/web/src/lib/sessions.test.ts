import { afterEach, describe, expect, it, vi } from 'vitest';
import { listSessions, revokeOtherSessions, revokeSession } from './sessions';

describe('sessions api-client calls', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(payload: unknown, status = 200): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(
      async () =>
        new Response(status === 204 ? null : JSON.stringify(payload), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('lists sessions with GET /auth/sessions', async () => {
    const fetchMock = stubFetch([]);
    await listSessions();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.endsWith('/auth/sessions')).toBe(true);
    expect(init.method).toBe('GET');
  });

  it('revokes one session with DELETE /auth/sessions/:id (URL-encoded)', async () => {
    const fetchMock = stubFetch(null, 204);
    await revokeSession('s-1/../2');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.endsWith('/auth/sessions/s-1%2F..%2F2')).toBe(true);
    expect(init.method).toBe('DELETE');
  });

  it('revokes the others with POST /auth/sessions/revoke-others', async () => {
    const fetchMock = stubFetch({ revoked: 3 });
    const out = await revokeOtherSessions();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.endsWith('/auth/sessions/revoke-others')).toBe(true);
    expect(init.method).toBe('POST');
    expect(out.revoked).toBe(3);
  });
});
