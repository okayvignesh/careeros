import { afterEach, describe, expect, it } from 'vitest';
import { EnvHttpProxyAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { installEgressProxy } from './proxy-dispatcher';

// A-H8/T6: guards the bootstrap that makes Node global fetch honour the
// HTTP(S)_PROXY env vars. If installEgressProxy stops installing a dispatcher,
// app egress silently bypasses the Squid allowlist again.
const original = getGlobalDispatcher();

afterEach(() => {
  if (getGlobalDispatcher() !== original) setGlobalDispatcher(original);
});

describe('installEgressProxy', () => {
  it('installs an EnvHttpProxyAgent when proxy env vars are present', () => {
    const logs: string[] = [];
    const installed = installEgressProxy(
      {
        HTTP_PROXY: 'http://squid:3128',
        HTTPS_PROXY: 'http://squid:3128',
        NO_PROXY: 'postgres,redis,minio,qdrant,localhost,127.0.0.1',
      },
      (m) => logs.push(m),
    );

    expect(installed).toBe(true);
    expect(getGlobalDispatcher()).toBeInstanceOf(EnvHttpProxyAgent);
    expect(logs.join(' ')).toContain('https=http://squid:3128');
  });

  it('leaves the global dispatcher unchanged when no proxy is configured', () => {
    const logs: string[] = [];
    const installed = installEgressProxy({}, (m) => logs.push(m));

    expect(installed).toBe(false);
    expect(getGlobalDispatcher()).toBe(original);
    expect(logs).toEqual([]);
  });

  it('fails closed when a proxy is configured but malformed', () => {
    const logs: string[] = [];
    expect(() =>
      installEgressProxy({ HTTPS_PROXY: 'not a url' }, (m) => logs.push(m)),
    ).toThrow(/HTTPS_PROXY is not a valid URL/);
    // Dispatcher must NOT have been swapped to something that egresses direct.
    expect(getGlobalDispatcher()).toBe(original);
    expect(logs.join(' ')).toContain('refusing to egress');
  });
});
