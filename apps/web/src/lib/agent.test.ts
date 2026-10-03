import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  devicePlatformLabel,
  deviceStatus,
  listAgentDevices,
  relativeTime,
  revokeAgentDevice,
  startAgentPairing,
} from './agent';

describe('devicePlatformLabel', () => {
  it('maps the three supported agent platforms', () => {
    expect(devicePlatformLabel('darwin')).toBe('macOS');
    expect(devicePlatformLabel('win32')).toBe('Windows');
    expect(devicePlatformLabel('linux')).toBe('Linux');
  });

  it('renders Unknown for null / unrecognised values (no guessing)', () => {
    expect(devicePlatformLabel(null)).toBe('Unknown');
    expect(devicePlatformLabel(undefined)).toBe('Unknown');
    expect(devicePlatformLabel('freebsd')).toBe('Unknown');
  });
});

describe('deviceStatus', () => {
  it('is Active until revokedAt is set', () => {
    expect(deviceStatus({ revokedAt: null })).toEqual({ label: 'Active', revoked: false });
    expect(deviceStatus({ revokedAt: '2026-01-01T00:00:00.000Z' })).toEqual({
      label: 'Revoked',
      revoked: true,
    });
  });
});

describe('relativeTime', () => {
  const now = Date.parse('2026-10-02T12:00:00.000Z');
  it('formats each bucket from an injected now', () => {
    expect(relativeTime(null, now)).toBe('Never');
    expect(relativeTime('not-a-date', now)).toBe('Unknown');
    expect(relativeTime(new Date(now - 10_000).toISOString(), now)).toBe('Just now');
    expect(relativeTime(new Date(now - 5 * 60_000).toISOString(), now)).toBe('5m ago');
    expect(relativeTime(new Date(now - 3 * 3_600_000).toISOString(), now)).toBe('3h ago');
    expect(relativeTime(new Date(now - 2 * 86_400_000).toISOString(), now)).toBe('2d ago');
  });

  it('clamps future timestamps to Just now rather than negative', () => {
    expect(relativeTime(new Date(now + 60_000).toISOString(), now)).toBe('Just now');
  });
});

describe('agent api-client calls', () => {
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

  it('lists devices with GET /agent/devices + cookies', async () => {
    const fetchMock = stubFetch([]);
    await listAgentDevices();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.endsWith('/agent/devices')).toBe(true);
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('include');
  });

  it('revokes with DELETE /agent/devices/:id', async () => {
    const fetchMock = stubFetch(null, 204);
    await revokeAgentDevice('dev-1');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.endsWith('/agent/devices/dev-1')).toBe(true);
    expect(init.method).toBe('DELETE');
  });

  it('mints a pairing code with POST /agent/pair/start', async () => {
    const fetchMock = stubFetch({ code: '123456', pairingRequestId: 'p', expiresAt: 'x' });
    await startAgentPairing();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.endsWith('/agent/pair/start')).toBe(true);
    expect(init.method).toBe('POST');
  });
});
