import { describe, expect, it } from 'vitest';
import { Reflector } from '@nestjs/core';
import { GmailController } from './gmail.controller';

/**
 * F.11: rate-limit decorator metadata on the public Pub/Sub push webhook.
 * The controller is un-cookied because Google's JWT is verified inside the
 * service; this test guards the raw request-rate ceiling that runs BEFORE
 * the JWT verify so a flood can't force an expensive verify per hit.
 */
describe('GmailController rate-limits (decorator metadata)', () => {
  it('webhooks/gmail/push is 300/min per IP (F.11)', () => {
    const reflector = new Reflector();
    const method = GmailController.prototype.push;
    const ttl = reflector.get<number>('THROTTLER:TTLdefault', method);
    const limit = reflector.get<number>('THROTTLER:LIMITdefault', method);
    expect(ttl).toBe(60_000);
    expect(limit).toBe(300);
    // MUTATION-SMOKE: delete the @Throttle decorator on `push` and both
    // reflector reads return undefined; this test fails.
  });
});
