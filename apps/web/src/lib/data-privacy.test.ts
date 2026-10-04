import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deleteAccount,
  exportAccountData,
  formatBytes,
  listPendingApprovals,
  reauthenticate,
} from './data-privacy';

describe('formatBytes', () => {
  it('scales through B/KB/MB/GB', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.0 GB');
  });

  it('is defensive about bad input', () => {
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
  });
});

describe('data-privacy api-client calls', () => {
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

  it('exports with POST /me/export', async () => {
    const fetchMock = stubFetch({
      url: 'http://x',
      key: 'exports/u/1.json.age',
      manifest: { tables: [] },
      encryptedBytes: 10,
    });
    await exportAccountData();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.endsWith('/me/export')).toBe(true);
    expect(init.method).toBe('POST');
  });

  it('deletes with POST /me/delete carrying confirmEmail', async () => {
    const fetchMock = stubFetch(null, 204);
    await deleteAccount('a@b.co');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.endsWith('/me/delete')).toBe(true);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ confirmEmail: 'a@b.co' });
  });

  it('re-auths with POST /auth/sign-in', async () => {
    const fetchMock = stubFetch({ id: 'u1', email: 'a@b.co' });
    await reauthenticate('a@b.co', 'secret-password');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.endsWith('/auth/sign-in')).toBe(true);
    expect(JSON.parse(String(init.body))).toEqual({ email: 'a@b.co', password: 'secret-password' });
  });

  it('lists pending approvals with a state filter', async () => {
    const fetchMock = stubFetch({ items: [], nextCursor: null });
    await listPendingApprovals(20);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.includes('/me/approvals?state=pending&limit=20')).toBe(true);
    expect(init.method).toBe('GET');
  });
});
