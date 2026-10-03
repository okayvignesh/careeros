import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChannelRegistry, SlackChannel, WebChannel } from '@careeros/messaging';
import type { SendPayload } from '@careeros/messaging';
import { DailyBriefDeliveryService, SLACK_BRIEF_CHANNEL_ENV } from './daily-brief-delivery.service';
import type { DailyBriefPayload } from './daily-brief-composer.service';

/**
 * E.3b delivery: routing is driven purely by the user's pref kinds, and a
 * failing transport is contained so the other channels + the persisted brief
 * survive. The registry is built by hand here; the module factory is a thin
 * adapter over the same Channel implementations.
 */

const BRIEF: DailyBriefPayload = {
  userId: 'u-1',
  composedAt: '2026-06-15T08:00:00.000Z',
  xp: { totalXp: 1420, deltaLast24h: 85 },
  streak: { currentDays: 5, longestDays: 12 },
  quests: [{ id: 'q1', title: 'Practice React state', skillName: 'React', dueAt: null }],
  jobMatches: [
    { id: 'a1', title: 'Backend Engineer', company: 'Stripe', location: 'Remote', postedAt: null },
  ],
  marketPulse: { risingSkill: 'Go', snapshotAt: '2026-06-14T00:00:00.000Z' },
};

function recordingRegistry() {
  const calls: Array<{ channel: string; payload: SendPayload }> = [];
  const registry = new ChannelRegistry();
  registry.register(
    new WebChannel(async (recipient, payload) => {
      calls.push({ channel: 'web', payload });
      return 'web-row-1';
    }),
  );
  registry.register(
    new SlackChannel(async (args) => {
      calls.push({ channel: 'slack', payload: { recipient: args.channel, plaintext_fallback: args.text } });
      return { ok: true, ts: 'slack-ts-1' };
    }),
  );
  return { registry, calls };
}

beforeEach(() => {
  process.env[SLACK_BRIEF_CHANNEL_ENV] = 'C-BRIEF';
});

afterEach(() => {
  delete process.env[SLACK_BRIEF_CHANNEL_ENV];
});

describe('DailyBriefDeliveryService.kindsFor', () => {
  it('maps the pref list through channelsFor for the daily_brief event', () => {
    const { registry } = recordingRegistry();
    const svc = new DailyBriefDeliveryService(registry);
    expect(svc.kindsFor({ userId: 'u-1', channels: ['slack', 'web'] })).toEqual(['slack', 'web']);
    expect(svc.kindsFor({ userId: 'u-1', channels: [] })).toEqual([]);
  });
});

describe('DailyBriefDeliveryService.deliver routing', () => {
  it('delivers only the opted-in kinds, in pref order', async () => {
    const { registry, calls } = recordingRegistry();
    const svc = new DailyBriefDeliveryService(registry);

    const outcomes = await svc.deliver('u-1', BRIEF, svc.kindsFor({ userId: 'u-1', channels: ['slack'] }));

    expect(calls.map((c) => c.channel)).toEqual(['slack']);
    expect(calls[0]!.payload.recipient).toBe('C-BRIEF');
    expect(outcomes).toEqual([{ kind: 'slack', ok: true, externalId: 'slack-ts-1' }]);
    // MUTATION-SMOKE: drop the kindsFor indirection and always deliver web,
    // and the slack-only assertion above fails.
  });

  it('reports channel_not_registered for a stubbed/unregistered kind without throwing', async () => {
    const { registry } = recordingRegistry();
    const svc = new DailyBriefDeliveryService(registry);
    const outcomes = await svc.deliver('u-1', BRIEF, ['whatsapp']);
    expect(outcomes).toEqual([{ kind: 'whatsapp', ok: false, error: 'channel_not_registered' }]);
  });

  it('skips slack with recipient_not_configured when no channel id is set', async () => {
    delete process.env[SLACK_BRIEF_CHANNEL_ENV];
    const { registry, calls } = recordingRegistry();
    const svc = new DailyBriefDeliveryService(registry);
    const outcomes = await svc.deliver('u-1', BRIEF, ['slack', 'web']);
    expect(calls.map((c) => c.channel)).toEqual(['web']);
    expect(outcomes).toEqual([
      { kind: 'slack', ok: false, error: 'recipient_not_configured' },
      { kind: 'web', ok: true, externalId: 'web-row-1' },
    ]);
  });
});

describe('DailyBriefDeliveryService failure containment', () => {
  it('a thrown Slack error does not abort the web mirror or lose the brief', async () => {
    const persisted: SendPayload[] = [];
    const registry = new ChannelRegistry();
    registry.register(
      new WebChannel(async (_recipient, payload) => {
        persisted.push(payload);
        return 'web-row-9';
      }),
    );
    registry.register(
      new SlackChannel(async () => {
        throw new Error('slack down');
      }),
    );
    const svc = new DailyBriefDeliveryService(registry);

    const outcomes = await svc.deliver('u-1', BRIEF, ['slack', 'web']);

    expect(outcomes).toEqual([
      { kind: 'slack', ok: false, error: 'slack down' },
      { kind: 'web', ok: true, externalId: 'web-row-9' },
    ]);
    // The web mirror still got the rendered brief.
    expect(persisted).toHaveLength(1);
    expect(persisted[0]!.plaintext_fallback).toContain('Daily brief');
    expect(persisted[0]!.blocks).toBeDefined();
    // MUTATION-SMOKE: remove the try/catch in deliver() and the throw kills
    // the fan-out before web persists; this assertion then fails.
  });

  it('a Slack ok:false is reported as an error, not thrown', async () => {
    const registry = new ChannelRegistry();
    registry.register(new WebChannel(async () => 'w'));
    registry.register(new SlackChannel(async () => ({ ok: false, error: 'channel_not_found' })));
    const svc = new DailyBriefDeliveryService(registry);

    const outcomes = await svc.deliver('u-1', BRIEF, ['slack']);
    expect(outcomes).toEqual([{ kind: 'slack', ok: false, error: 'channel_not_found' }]);
  });
});
