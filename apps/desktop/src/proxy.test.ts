import { describe, expect, it, vi } from 'vitest';
import { applyProxy, parseProxyEnv, type SessionLike } from './proxy';

/**
 * D.8 proxy tests. Env parsing is the only non-trivial logic (both
 * HTTP_PROXY + lowercase http_proxy, NO_PROXY shape normalization);
 * applyProxy is a one-line wrapper verified by capturing the setProxy call.
 */

describe('parseProxyEnv', () => {
  it('returns null when no proxy env is set', () => {
    expect(parseProxyEnv({})).toBeNull();
  });

  it('builds proxyRules from HTTP_PROXY + HTTPS_PROXY', () => {
    const cfg = parseProxyEnv({
      HTTP_PROXY: 'http://p1:8080',
      HTTPS_PROXY: 'http://p2:8443',
    });
    expect(cfg?.proxyRules).toBe('http=http://p1:8080;https=http://p2:8443');
    expect(cfg?.proxyBypassRules).toBeUndefined();
  });

  it('honours lowercase env names (curl-style)', () => {
    const cfg = parseProxyEnv({
      http_proxy: 'http://p1:8080',
      no_proxy: 'localhost,.internal',
    });
    expect(cfg?.proxyRules).toBe('http=http://p1:8080');
    expect(cfg?.proxyBypassRules).toBe('localhost,.internal');
  });

  it('normalises NO_PROXY whitespace into Chromium comma list', () => {
    const cfg = parseProxyEnv({
      HTTPS_PROXY: 'http://p:8080',
      NO_PROXY: 'localhost  .internal, 10.0.0.0/8',
    });
    expect(cfg?.proxyBypassRules).toBe('localhost,.internal,10.0.0.0/8');
  });
});

describe('applyProxy', () => {
  function fakeSession(): SessionLike & { calls: Array<{ proxyRules?: string; proxyBypassRules?: string }> } {
    return {
      calls: [],
      async setProxy(c) {
        this.calls.push(c);
      },
    };
  }

  it('applies the env-derived proxy to the session', async () => {
    const s = fakeSession();
    const cfg = await applyProxy(s, undefined, {
      HTTPS_PROXY: 'http://p:8443',
      NO_PROXY: 'localhost',
    });
    expect(cfg).not.toBeNull();
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]!.proxyRules).toContain('https=http://p:8443');
    expect(s.calls[0]!.proxyBypassRules).toBe('localhost');
  });

  it('override (future Settings UI) wins over env', async () => {
    const s = fakeSession();
    const cfg = await applyProxy(
      s,
      { proxyRules: 'http=override:1234' },
      { HTTPS_PROXY: 'http://env-wins-no:8443' },
    );
    expect(cfg?.proxyRules).toBe('http=override:1234');
    expect(s.calls[0]!.proxyRules).toBe('http=override:1234');
  });

  it('empty env + no override resets the session proxy (clears any prior)', async () => {
    const s = fakeSession();
    const cfg = await applyProxy(s, undefined, {});
    expect(cfg).toBeNull();
    expect(s.calls[0]).toEqual({ proxyRules: '', proxyBypassRules: '' });
  });
});
