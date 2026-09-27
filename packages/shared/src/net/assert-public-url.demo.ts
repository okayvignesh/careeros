// Assert-based self-check for assertPublicUrl (A-C2 SSRF guard). No test framework.
// Run: npx tsx packages/shared/src/net/assert-public-url.demo.ts
import assert from 'node:assert/strict';
import {
  assertPublicUrl,
  assertPublicUrlShape,
  safeFetch,
  setSsrfAuditHook,
  SsrfBlockedError,
} from './assert-public-url';

// Injectable DNS resolver: tests never hit the real network.
type DnsRecord = { address: string; family: number };
function fakeLookup(map: Record<string, DnsRecord[]>) {
  return async (host: string): Promise<DnsRecord[]> => {
    const rec = map[host];
    if (!rec) throw new Error(`ENOTFOUND ${host}`);
    return rec;
  };
}

const auditEvents: Array<{ code: string; reason: string; host?: string; ip?: string }> = [];
setSsrfAuditHook((evt) => {
  auditEvents.push({ code: evt.code, reason: evt.reason, host: evt.host, ip: evt.ip });
});

function label(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      // eslint-disable-next-line no-console
      console.log(`ok ${name}`);
    });
}

async function expectReject(fn: () => Promise<unknown>, expectedReason: string): Promise<void> {
  try {
    await fn();
  } catch (err) {
    assert(err instanceof SsrfBlockedError, `expected SsrfBlockedError, got ${(err as Error).name}`);
    assert.equal(err.detail.reason, expectedReason);
    return;
  }
  throw new Error(`did not reject; expected ${expectedReason}`);
}

async function main(): Promise<void> {
  await label('rejects IP literal 169.254.169.254 (AWS metadata)', async () => {
    // Mutation smoke: if isPrivateIPv4() drops the 169.254 case, this passes.
    auditEvents.length = 0;
    await expectReject(
      () => assertPublicUrl('http://169.254.169.254/latest/meta-data/'),
      // host_not_allowlisted fires first for IP literals; that's still a reject.
      'host_not_allowlisted',
    );
    assert(auditEvents.some((e) => e.code === 'security.audit.ssrf_rejected'));
  });

  await label('rejects IP literal 10.0.0.1 (RFC1918)', async () => {
    // Mutation smoke: if 10/8 check is removed AND allowlist widened, resolves-to-private catches it.
    await expectReject(() => assertPublicUrl('http://10.0.0.1/'), 'host_not_allowlisted');
  });

  await label('rejects allowlisted host that resolves to a private IP', async () => {
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

  await label('rejects postgres hostname (Docker internal service)', async () => {
    // Mutation smoke: dropping the allowlist entirely -> this test still catches it
    // via the DNS check (private IP), but the fast-fail allowlist reason is expected.
    await expectReject(() => assertPublicUrl('http://postgres:5432/'), 'host_not_allowlisted');
  });

  await label('rejects minio hostname (Docker internal service)', async () => {
    await expectReject(() => assertPublicUrl('http://minio:9000/'), 'host_not_allowlisted');
  });

  await label('rejects redirect from allowed host to metadata IP', async () => {
    // safeFetch must re-validate Location; here we stub fetch to return a 302 to
    // 169.254.169.254 and expect a rejection on hop 2.
    const originalFetch = globalThis.fetch;
    let hops = 0;
    (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (input: RequestInfo | URL) => {
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
      // Provide a fake lookup so allowed host resolves publicly (skip real DNS).
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
      assert(hops >= 1);
    } finally {
      (globalThis as unknown as { fetch: typeof fetch }).fetch = originalFetch;
    }
  });

  await label('accepts allowlisted host (api.deepseek.com) with public IP', async () => {
    // Mutation smoke: if reject path always throws -> this fails.
    const url = await assertPublicUrl('https://api.deepseek.com/v1/', {
      lookup: fakeLookup({ 'api.deepseek.com': [{ address: '1.2.3.4', family: 4 }] }),
    });
    assert.equal(url.hostname, 'api.deepseek.com');
  });

  await label('rejects non-allowlisted host (evil.example.com)', async () => {
    await expectReject(
      () =>
        assertPublicUrl('https://evil.example.com/', {
          lookup: fakeLookup({ 'evil.example.com': [{ address: '1.2.3.4', family: 4 }] }),
        }),
      'host_not_allowlisted',
    );
  });

  await label('production mode forbids plaintext http even for allowlisted hosts', async () => {
    // Mutation smoke: if isProd branch removed -> localhost over http would pass in prod.
    await expectReject(
      () =>
        assertPublicUrl('http://api.deepseek.com/v1/', {
          nodeEnv: 'production',
          lookup: fakeLookup({ 'api.deepseek.com': [{ address: '1.2.3.4', family: 4 }] }),
        }),
      'plaintext_in_production',
    );
  });

  await label('production mode forbids localhost even over https', async () => {
    await expectReject(
      () =>
        assertPublicUrl('https://localhost/', {
          nodeEnv: 'production',
          lookup: fakeLookup({ localhost: [{ address: '127.0.0.1', family: 4 }] }),
        }),
      'dev_only_host_in_production',
    );
  });

  await label('rejects unsupported protocol (file://)', async () => {
    await expectReject(() => assertPublicUrl('file:///etc/passwd'), 'unsupported_protocol');
  });

  await label('assertPublicUrlShape catches literal private IPs without DNS', () => {
    assert.throws(
      () => assertPublicUrlShape('http://169.254.169.254/'),
      (err: unknown) => err instanceof SsrfBlockedError && err.detail.reason === 'host_not_allowlisted',
    );
  });

  // eslint-disable-next-line no-console
  console.log('\nall assertPublicUrl checks passed');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
