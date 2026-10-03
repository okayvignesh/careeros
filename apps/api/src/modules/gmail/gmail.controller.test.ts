import { describe, expect, it, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { GmailController } from './gmail.controller';
import { GmailService } from './gmail.service';
import { SessionService } from '../auth/session.service';

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

/**
 * The OAuth callback is reached by the user's browser (top-level GET from
 * Google) and by API clients, so it must redirect browsers to the web UI while
 * keeping the existing JSON shape for non-browser callers. State/session
 * checks are unchanged (covered by the service tests).
 */
describe('GmailController OAuth return hop', () => {
  function build(accept: string | undefined) {
    const gmail = {
      finishOAuth: vi.fn().mockResolvedValue({
        historyId: '5',
        expiration: new Date('2026-01-01T00:00:00.000Z'),
      }),
    } as unknown as GmailService;
    const session = { read: () => ({ userId: 'u-1' }) } as unknown as SessionService;
    const req = { headers: accept === undefined ? {} : { accept } } as unknown as Request;
    return { ctrl: new GmailController(gmail, session), req };
  }

  function fakeRes() {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    return {
      status,
      json,
      redirect: vi.fn(),
    } as unknown as Response & {
      status: ReturnType<typeof vi.fn>;
      json: ReturnType<typeof vi.fn>;
      redirect: ReturnType<typeof vi.fn>;
    };
  }

  it('302s a browser (text/html) return to the web settings page', async () => {
    process.env.WEB_URL = 'https://web.test';
    const { ctrl, req } = build('text/html,application/xhtml+xml');
    const res = fakeRes();
    await ctrl.callback('code_1', 'u-1', undefined, req, res);
    expect(res.redirect).toHaveBeenCalledWith(
      302,
      'https://web.test/settings/integrations?connected=gmail',
    );
    expect(res.json).not.toHaveBeenCalled();
  });

  it('keeps JSON for non-browser clients', async () => {
    delete process.env.WEB_URL;
    const { ctrl, req } = build('*/*');
    const res = fakeRes();
    await ctrl.callback('code_1', 'u-1', undefined, req, res);
    expect(res.redirect).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      historyId: '5',
      expiration: '2026-01-01T00:00:00.000Z',
    });
  });
});
