import { afterEach, describe, expect, it } from 'vitest';
import {
  captureException,
  flushSentry,
  initSentry,
  resolveSentryDsn,
  resolveSentryRelease,
  scrubEvent,
} from './sentry';

const ENV_KEYS = ['SENTRY_DSN', 'GLITCHTIP_DSN', 'SENTRY_RELEASE', 'GIT_SHA'] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('sentry bootstrap', () => {
  it('is a complete no-op when no DSN is configured', async () => {
    delete process.env.SENTRY_DSN;
    delete process.env.GLITCHTIP_DSN;
    expect(resolveSentryDsn()).toBeUndefined();
    expect(initSentry()).toBe(false);
    expect(() => captureException(new Error('boom'))).not.toThrow();
    await expect(flushSentry()).resolves.toBeUndefined();
  });

  it('accepts GLITCHTIP_DSN as an alias and ignores blank values', () => {
    delete process.env.SENTRY_DSN;
    process.env.GLITCHTIP_DSN = 'https://key@glitchtip/1';
    expect(resolveSentryDsn()).toBe('https://key@glitchtip/1');
    // Compose passes empty strings for unset vars; they must not shadow the alias.
    process.env.SENTRY_DSN = '   ';
    expect(resolveSentryDsn()).toBe('https://key@glitchtip/1');
    process.env.SENTRY_DSN = 'https://key@sentry/2';
    expect(resolveSentryDsn()).toBe('https://key@sentry/2');
  });

  it('resolves the git SHA as the release tag, ignoring blank overrides', () => {
    process.env.SENTRY_RELEASE = '';
    process.env.GIT_SHA = 'abc123def';
    expect(resolveSentryRelease()).toBe('abc123def');
    process.env.SENTRY_RELEASE = 'v1.2.3';
    expect(resolveSentryRelease()).toBe('v1.2.3');
  });

  it('scrubs identity, secret keys and bearer patterns before transport', () => {
    const scrubbed = scrubEvent({
      user: { id: 'user-1', email: 'a@b.c' },
      request: { headers: { authorization: 'Bearer abcdefghijklmnopqrstuvwxyz' } },
      extra: {
        access_token: 'secret',
        nested: { password: 'hunter2' },
        message: 'failed with sk-abcdefghijklmnopqrstuvwxyz',
      },
    }) as Record<string, unknown>;

    expect(scrubbed.user).toBeUndefined();
    expect(scrubbed.request).toBeUndefined();
    const extra = scrubbed.extra as Record<string, unknown>;
    expect(extra.access_token).toBe('[REDACTED]');
    expect((extra.nested as Record<string, unknown>).password).toBe('[REDACTED]');
    expect(extra.message).toBe('failed with [REDACTED]');
  });
});
