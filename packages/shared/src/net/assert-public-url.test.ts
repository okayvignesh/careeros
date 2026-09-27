import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assertPublicUrl,
  assertPublicUrlShape,
  safeFetch,
  setSsrfAuditHook,
  SsrfBlockedError,
} from './assert-public-url';

// Injectable DNS resolver so tests never hit the real network.
type DnsRecord = { address: string; family: number };
function fakeLookup(map: Record<string, DnsRecord[]>) {
  return async (host: string): Promise<DnsRecord[]> => {
    const rec = map[host];
    if (!rec) throw new Error(`ENOTFOUND ${host}`);
    return rec;
  };
}

async function expectReject(
  fn: () => Promise<unknown>,
  expectedReason: string,
): Promise<SsrfBlockedError> {
  let caught: unknown = null;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  expect(caught, `expected SsrfBlockedError with reason=${expectedReason}`).toBeInstanceOf(
    SsrfBlockedError,
  );
  const err = caught as SsrfBlockedError;
  expect(err.detail.reason).toBe(expectedReason);
  return err;
}

describe('assertPublicUrl (A-C2 SSRF guard)', () => {
  const auditEvents: Array<{ code: string; reason: string; host?: string; ip?: string }> = [];

  beforeEach(() => {
    auditEvents.length = 0;
    setSsrfAuditHook((evt) => {
      auditEvents.push({ code: evt.code, reason: evt.reason, host: evt.host, ip: evt.ip });
    });
  });

  afterEach(() => {
    setSsrfAuditHook(null);
  });

  it('rejects IP literal 169.254.169.254 (AWS metadata) + emits audit event', async () => {
    // Mutation smoke: if isPrivateIPv4() drops the 169.254 case, host_not_allowlisted still fires.
    await expectReject(
      () => assertPublicUrl('http://169.254.169.254/latest/meta-data/'),
      'host_not_allowlisted',
    );
    expect(auditEvents.some((e) => e.code === 'security.audit.ssrf_rejected')).toBe(true);
  });

  it('rejects IP literal 10.0.0.1 (RFC1918)', async () => {
    await expectReject(() => assertPublicUrl('http://10.0.0.1/'), 'host_not_allowlisted');
  });

  it('rejects allowlisted host that resolves to a private IP', async () => {
    // Even localhost passes the allowlist, but if a rogue DNS points api.deepseek.com
    // at 10.x we must reject. Mutation smoke: drops DNS check -> this passes.
    await expectReject(
      () =>
        assertPublicUrl('https://api.deepseek.com/v1/', {
          lookup: fakeLookup({ 'api.deepseek.com': [{ address: '10.0.0.7', family: 4 }] }),
        }),
      'resolved_to_private_ip',
    );
  });

  it('rejects postgres hostname (Docker internal service)', async () => {
    await expectReject(() => assertPublicUrl('http://postgres:5432/'), 'host_not_allowlisted');
  });

  it('rejects minio hostname (Docker internal service)', async () => {
    await expectReject(() => assertPublicUrl('http://minio:9000/'), 'host_not_allowlisted');
  });

  it('safeFetch rejects redirect from allowed host to metadata IP', async () => {
    const originalFetch = globalThis.fetch;
    let hops = 0;
    (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (
      input: RequestInfo | URL,
    ) => {
      hops++;
      const url = typeof input === 'string' ? input : (input as URL).toString();
      if (url.includes('api.deepseek.com')) {
        return new Response(null, {
          status: 302,
          headers: { location: 'http://169.254.169.254/latest/meta-data/' },
        });
      }
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    try {
      await expectReject(
        () =>
          safeFetch(
            'https://api.deepseek.com/v1',
            {},
            {
              lookup: fakeLookup({
                'api.deepseek.com': [{ address: '1.1.1.1', family: 4 }],
                '169.254.169.254': [{ address: '169.254.169.254', family: 4 }],
              }),
            },
          ),
        'host_not_allowlisted',
      );
      expect(hops).toBeGreaterThanOrEqual(1);
    } finally {
      (globalThis as unknown as { fetch: typeof fetch }).fetch = originalFetch;
    }
  });

  it('accepts allowlisted host (api.deepseek.com) with public IP', async () => {
    const url = await assertPublicUrl('https://api.deepseek.com/v1/', {
      lookup: fakeLookup({ 'api.deepseek.com': [{ address: '1.2.3.4', family: 4 }] }),
    });
    expect(url.hostname).toBe('api.deepseek.com');
  });

  it('rejects non-allowlisted host (evil.example.com)', async () => {
    await expectReject(
      () =>
        assertPublicUrl('https://evil.example.com/', {
          lookup: fakeLookup({ 'evil.example.com': [{ address: '1.2.3.4', family: 4 }] }),
        }),
      'host_not_allowlisted',
    );
  });

  it('production mode forbids plaintext http even for allowlisted hosts', async () => {
    await expectReject(
      () =>
        assertPublicUrl('http://api.deepseek.com/v1/', {
          nodeEnv: 'production',
          lookup: fakeLookup({ 'api.deepseek.com': [{ address: '1.2.3.4', family: 4 }] }),
        }),
      'plaintext_in_production',
    );
  });

  it('production mode forbids localhost even over https', async () => {
    await expectReject(
      () =>
        assertPublicUrl('https://localhost/', {
          nodeEnv: 'production',
          lookup: fakeLookup({ localhost: [{ address: '127.0.0.1', family: 4 }] }),
        }),
      'dev_only_host_in_production',
    );
  });

  it('rejects unsupported protocol (file://)', async () => {
    await expectReject(() => assertPublicUrl('file:///etc/passwd'), 'unsupported_protocol');
  });

  it('assertPublicUrlShape catches literal private IPs without DNS', () => {
    expect(() => assertPublicUrlShape('http://169.254.169.254/')).toThrow(SsrfBlockedError);
    try {
      assertPublicUrlShape('http://169.254.169.254/');
    } catch (err) {
      expect(err).toBeInstanceOf(SsrfBlockedError);
      expect((err as SsrfBlockedError).detail.reason).toBe('host_not_allowlisted');
    }
  });
});
