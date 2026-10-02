// Controller tests. We drive the handlers with a fake `Request` (raw body +
// headers) instead of standing up a full Nest HTTP layer - the controller's
// job is signature-verify + route + reply, all pure of transport concerns.
import { HttpException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionService } from '../auth/session.service';
import { SlackController } from './slack.controller';
import { SlackService } from './slack.service';
import { SlackOAuthService } from './slack.oauth';

const SECRET = 'controller_test_signing_secret_16char';

function sign(body: string, ts: string): string {
  return 'v0=' + createHmac('sha256', SECRET).update(`v0:${ts}:${body}`).digest('hex');
}

function fakeReq(rawBody: string, sig?: string, ts?: string) {
  const headers: Record<string, string> = {};
  if (sig !== undefined) headers['x-slack-signature'] = sig;
  if (ts !== undefined) headers['x-slack-request-timestamp'] = ts;
  return {
    rawBody: Buffer.from(rawBody, 'utf8'),
    header: (k: string) => headers[k.toLowerCase()],
  } as unknown as Parameters<SlackController['events']>[0];
}

function buildController(session: SessionService = fakeSession('u-1')) {
  const slack = new SlackService();
  // Stub redis so markEvent is deterministic without a live instance.
  const seen = new Set<string>();
  const stub = {
    set: async (...args: unknown[]) => {
      const [k, _v, _ex, _t, mode] = args as [string, string, string, number, string];
      if (mode === 'NX' && seen.has(k)) return null;
      seen.add(k);
      return 'OK';
    },
  };
  (slack as unknown as { redis: typeof stub }).redis = stub;
  const oauth = { completeInstall: vi.fn(), loadBotToken: vi.fn() } as unknown as SlackOAuthService;
  return new SlackController(slack, oauth, session);
}

/** Sealed-session double: `read` returns a session only when a userId is set. */
function fakeSession(userId: string | null): SessionService {
  return {
    read: () =>
      userId
        ? { userId, sessionId: 's-1', createdAt: 0, expiresAt: Date.now() + 60_000 }
        : null,
    requireUserId: () => {
      if (!userId) throw new Error('not signed in');
      return userId;
    },
  } as unknown as SessionService;
}

beforeAll(() => {
  process.env.SLACK_SIGNING_SECRET = SECRET;
});

afterAll(() => {
  delete process.env.SLACK_SIGNING_SECRET;
});

describe('SlackController.events', () => {
  let ctrl: SlackController;
  beforeEach(() => {
    ctrl = buildController();
  });

  it('returns challenge for url_verification handshake', async () => {
    const body = JSON.stringify({ type: 'url_verification', challenge: 'ch-123' });
    const ts = String(Math.floor(Date.now() / 1000));
    const req = fakeReq(body, sign(body, ts), ts);
    const res = await ctrl.events(req);
    expect(res).toEqual({ challenge: 'ch-123' });
  });

  it('processes event_callback and dedupes on second delivery', async () => {
    const body = JSON.stringify({
      type: 'event_callback',
      event_id: 'Ev-42',
      event: { type: 'message.im' },
    });
    const ts = String(Math.floor(Date.now() / 1000));
    const req = fakeReq(body, sign(body, ts), ts);
    const first = await ctrl.events(req);
    const second = await ctrl.events(fakeReq(body, sign(body, ts), ts));
    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true, dedup: true });
  });

  it('rejects with 401 when signature header is missing', async () => {
    const body = '{}';
    const ts = String(Math.floor(Date.now() / 1000));
    await expect(ctrl.events(fakeReq(body, undefined, ts))).rejects.toBeInstanceOf(HttpException);
    try {
      await ctrl.events(fakeReq(body, undefined, ts));
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(401);
    }
  });

  it('rejects with 401 when signature is wrong', async () => {
    const body = '{}';
    const ts = String(Math.floor(Date.now() / 1000));
    await expect(ctrl.events(fakeReq(body, 'v0=deadbeef', ts))).rejects.toMatchObject({
      status: 401,
    });
  });

  it('rejects with 401 when timestamp is stale (>5 min)', async () => {
    const body = '{}';
    const ts = String(Math.floor(Date.now() / 1000) - 6 * 60);
    await expect(ctrl.events(fakeReq(body, sign(body, ts), ts))).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe('SlackController.commands', () => {
  let ctrl: SlackController;
  beforeEach(() => {
    ctrl = buildController();
  });

  it('routes /quiz slash command with topic', async () => {
    const body = new URLSearchParams({
      command: '/quiz',
      text: 'graphs',
      user_id: 'U1',
      channel_id: 'C1',
      team_id: 'T1',
    }).toString();
    const ts = String(Math.floor(Date.now() / 1000));
    const req = fakeReq(body, sign(body, ts), ts);
    const res = await ctrl.commands(req);
    expect(JSON.stringify(res)).toContain('graphs');
    expect(JSON.stringify(res)).toContain('assessment:start:');
  });

  it('rejects unsigned slash command', async () => {
    const body = 'command=%2Fquiz&text=&user_id=U1';
    await expect(ctrl.commands(fakeReq(body))).rejects.toMatchObject({ status: 401 });
  });
});

describe('SlackController.interactive', () => {
  it('parses payload and acks with action_id', async () => {
    const ctrl = buildController();
    const payloadObj = { actions: [{ action_id: 'approval:approve:apr-9' }] };
    const body = new URLSearchParams({ payload: JSON.stringify(payloadObj) }).toString();
    const ts = String(Math.floor(Date.now() / 1000));
    const req = fakeReq(body, sign(body, ts), ts);
    const res = await ctrl.interactive(req);
    expect(JSON.stringify(res)).toContain('approval:approve:apr-9');
  });
});

const OAUTH_REDIRECT = 'https://api.test/webhooks/slack/oauth/callback';

/** Controller wired with a stateful in-memory Redis double so the real
 * create/consume state path runs end-to-end without a live Redis. */
function buildOauth(userId: string | null = 'u-owner') {
  process.env.SLACK_OAUTH_REDIRECT_URI = OAUTH_REDIRECT;
  const slack = new SlackService();
  const stateStore = new Map<string, string>();
  const stub = {
    set: async (...args: unknown[]) => {
      const [k, v] = args as [string, string];
      stateStore.set(k, v);
      return 'OK';
    },
    getdel: async (k: string) => {
      const v = stateStore.get(k) ?? null;
      stateStore.delete(k);
      return v;
    },
  };
  (slack as unknown as { redis: typeof stub }).redis = stub;
  const oauth = {
    completeInstall: vi.fn().mockResolvedValue({
      ok: true,
      teamId: 'T1',
      teamName: 'Test',
      botUserId: 'B1',
      appId: 'A1',
      scopes: ['chat:write'],
    }),
    loadBotToken: vi.fn(),
  } as unknown as SlackOAuthService;
  return { ctrl: new SlackController(slack, oauth, fakeSession(userId)), slack, oauth };
}

describe('SlackController.oauthStart', () => {
  it('requires an authenticated session', async () => {
    const { ctrl } = buildOauth(null);
    await expect(ctrl.oauthStart(fakeReq(''))).rejects.toBeDefined();
  });

  it('returns a Slack authorize URL carrying a user-bound one-time state', async () => {
    process.env.SLACK_CLIENT_ID = 'client_1';
    const { ctrl, slack } = buildOauth('u-owner');
    const { url } = await ctrl.oauthStart(fakeReq(''));
    expect(url).toContain('https://slack.com/oauth/v2/authorize');
    const state = new URL(url).searchParams.get('state');
    expect(state).toBeTruthy();
    expect(await slack.consumeOAuthState(state as string, 'u-owner')).toBe(true);
    // one-time-use: a second consume fails
    expect(await slack.consumeOAuthState(state as string, 'u-owner')).toBe(false);
  });
});

describe('SlackController.oauthCallback', () => {
  it('rejects when code is missing', async () => {
    const { ctrl, slack } = buildOauth();
    const state = await slack.createOAuthState('u-owner');
    await expect(ctrl.oauthCallback(undefined, state, fakeReq(''))).rejects.toMatchObject({
      status: 400,
    });
  });

  it('rejects when state is missing', async () => {
    const { ctrl } = buildOauth();
    await expect(ctrl.oauthCallback('code_123', undefined, fakeReq(''))).rejects.toMatchObject({
      status: 400,
    });
  });

  it('rejects when there is no authenticated session', async () => {
    const { ctrl, slack } = buildOauth(null);
    const state = await slack.createOAuthState('u-owner');
    await expect(ctrl.oauthCallback('code_123', state, fakeReq(''))).rejects.toMatchObject({
      status: 400,
    });
  });

  it('rejects a state minted for another user', async () => {
    const { ctrl, slack, oauth } = buildOauth('u-attacker');
    const state = await slack.createOAuthState('u-owner');
    await expect(ctrl.oauthCallback('code_123', state, fakeReq(''))).rejects.toMatchObject({
      status: 400,
    });
    expect(oauth.completeInstall).not.toHaveBeenCalled();
  });

  it('rejects an expired state', async () => {
    const { ctrl, slack, oauth } = buildOauth('u-owner');
    // Mint the nonce 11 min ago (TTL is 10 min) so `expiresAt` is in the past.
    const state = await slack.createOAuthState('u-owner', Date.now() - 11 * 60 * 1000);
    await expect(ctrl.oauthCallback('code_123', state, fakeReq(''))).rejects.toMatchObject({
      status: 400,
    });
    expect(oauth.completeInstall).not.toHaveBeenCalled();
  });

  it('accepts a valid state and pins the server-configured redirect_uri', async () => {
    const { ctrl, slack, oauth } = buildOauth('u-owner');
    const state = await slack.createOAuthState('u-owner');
    const res = await ctrl.oauthCallback('code_123', state, fakeReq(''));
    expect(res).toMatchObject({ ok: true, team: { id: 'T1', name: 'Test' } });
    // Caller-supplied redirect_uri is never consulted; the registered env value is.
    expect(oauth.completeInstall).toHaveBeenCalledWith('code_123', OAUTH_REDIRECT);
  });

  it('rejects replay of an already-consumed state', async () => {
    const { ctrl, slack } = buildOauth('u-owner');
    const state = await slack.createOAuthState('u-owner');
    await ctrl.oauthCallback('code_123', state, fakeReq(''));
    await expect(ctrl.oauthCallback('code_123', state, fakeReq(''))).rejects.toMatchObject({
      status: 400,
    });
  });
});
