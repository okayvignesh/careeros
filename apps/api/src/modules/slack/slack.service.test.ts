// SlackService: signature verify + event dedupe.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { SlackService } from './slack.service';

const SECRET = 'test_signing_secret_do_not_use_in_prod';

function sign(rawBody: string, ts: string, secret = SECRET): string {
  return 'v0=' + createHmac('sha256', secret).update(`v0:${ts}:${rawBody}`).digest('hex');
}

describe('SlackService.verify', () => {
  let svc: SlackService;

  beforeAll(() => {
    process.env.SLACK_SIGNING_SECRET = SECRET;
  });

  beforeEach(() => {
    svc = new SlackService();
  });

  afterAll(async () => {
    // no-op: ioredis lazyConnect never opened.
  });

  it('accepts a well-formed request', () => {
    const body = '{"type":"event_callback","event_id":"Ev1"}';
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = sign(body, ts);
    expect(svc.verify(body, sig, ts).ok).toBe(true);
  });

  it('rejects when signature header is missing', () => {
    const body = '{}';
    const ts = String(Math.floor(Date.now() / 1000));
    const r = svc.verify(body, undefined, ts);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('missing_signature');
  });

  it('rejects when timestamp header is missing', () => {
    const body = '{}';
    const r = svc.verify(body, 'v0=deadbeef', undefined);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('missing_timestamp');
  });

  it('rejects a wrong signature (right shape, wrong bytes)', () => {
    const body = '{}';
    const ts = String(Math.floor(Date.now() / 1000));
    // Use the wrong secret to build a plausible-length but incorrect sig.
    const badSig = sign(body, ts, 'wrong_secret_wrong_secret_wrong_secret');
    const r = svc.verify(body, badSig, ts);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('bad_signature');
  });

  it('rejects a truncated signature without throwing', () => {
    const body = '{}';
    const ts = String(Math.floor(Date.now() / 1000));
    const r = svc.verify(body, 'v0=short', ts);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('bad_signature');
  });

  it('rejects a stale timestamp (>5 min old)', () => {
    const body = '{}';
    const now = Date.now();
    const ts = String(Math.floor(now / 1000) - 6 * 60);
    const sig = sign(body, ts);
    const r = svc.verify(body, sig, ts, now);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('stale_timestamp');
  });

  it('rejects a future timestamp beyond skew window', () => {
    const body = '{}';
    const now = Date.now();
    const ts = String(Math.floor(now / 1000) + 6 * 60);
    const sig = sign(body, ts);
    const r = svc.verify(body, sig, ts, now);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('stale_timestamp');
  });

  it('rejects a malformed (non-numeric) timestamp', () => {
    const r = svc.verify('{}', 'v0=x', 'not_a_number');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('malformed_timestamp');
  });

  it('rejects when SLACK_SIGNING_SECRET is not configured', () => {
    delete process.env.SLACK_SIGNING_SECRET;
    const svc2 = new SlackService();
    const r = svc2.verify('{}', 'v0=x', String(Math.floor(Date.now() / 1000)));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('missing_signing_secret');
    process.env.SLACK_SIGNING_SECRET = SECRET;
  });

  // Mutation smoke: flipping one byte of the raw body must invalidate the sig.
  it('body tampering invalidates the signature', () => {
    const body = '{"a":1}';
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = sign(body, ts);
    const r = svc.verify('{"a":2}', sig, ts);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('bad_signature');
  });
});

describe('SlackService.markEvent (dedupe)', () => {
  it('first sighting returns true, second returns false (Redis SET NX)', async () => {
    const svc = new SlackService();
    // Stub the internal redis client without needing a live Redis.
    const seen = new Map<string, string>();
    (svc as unknown as { redis: { set: (...args: unknown[]) => Promise<string | null> } }).redis = {
      set: async (key: string, _v: string, _ex: string, _ttl: number, mode: string) => {
        if (mode === 'NX' && seen.has(key)) return null;
        seen.set(key, '1');
        return 'OK';
      },
    };
    expect(await svc.markEvent('Ev1')).toBe(true);
    expect(await svc.markEvent('Ev1')).toBe(false);
    expect(await svc.markEvent('Ev2')).toBe(true);
  });

  it('fails open (returns true) if Redis throws', async () => {
    const svc = new SlackService();
    (svc as unknown as { redis: { set: () => Promise<string> } }).redis = {
      set: () => {
        throw new Error('redis down');
      },
    };
    const warn = vi.spyOn(svc['logger'], 'warn').mockImplementation(() => {});
    expect(await svc.markEvent('Ev1')).toBe(true);
    expect(warn).toHaveBeenCalled();
  });
});
