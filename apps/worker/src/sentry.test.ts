import { afterEach, describe, expect, it } from 'vitest';
import { captureException, flushSentry, initSentry, scrubEvent } from './sentry';

const ENV_KEYS = ['SENTRY_DSN', 'GLITCHTIP_DSN'] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('worker sentry bootstrap', () => {
  it('is a complete no-op when no DSN is configured', async () => {
    delete process.env.SENTRY_DSN;
    delete process.env.GLITCHTIP_DSN;
    expect(initSentry()).toBe(false);
    expect(() => captureException(new Error('boom'))).not.toThrow();
    await expect(flushSentry()).resolves.toBeUndefined();
  });

  it('scrubs identity and secrets before transport', () => {
    const scrubbed = scrubEvent({
      user: { id: 'user-1' },
      request: { headers: { cookie: 'a=b' } },
      extra: { token: 'secret' },
    }) as Record<string, unknown>;
    expect(scrubbed.user).toBeUndefined();
    expect(scrubbed.request).toBeUndefined();
    expect((scrubbed.extra as Record<string, unknown>).token).toBe('[REDACTED]');
  });
});
