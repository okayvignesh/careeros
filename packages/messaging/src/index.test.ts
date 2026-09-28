import { describe, expect, it, vi } from 'vitest';
import {
  ChannelRegistry,
  DiscordChannel,
  NotImplementedError,
  SlackChannel,
  WebChannel,
  WhatsAppChannel,
  channelsFor,
  type SendPayload,
} from './index';

const PAYLOAD: SendPayload = {
  recipient: 'U123',
  plaintext_fallback: 'hello world',
  blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'hi' } }],
};

describe('WebChannel', () => {
  it('calls the writer and returns its id as externalId', async () => {
    const writer = vi.fn().mockResolvedValue('row-42');
    const ch = new WebChannel(writer);
    const res = await ch.send({ ...PAYLOAD, recipient: 'user-1' });
    expect(res).toEqual({ ok: true, externalId: 'row-42' });
    expect(writer).toHaveBeenCalledWith('user-1', { ...PAYLOAD, recipient: 'user-1' });
    // MUTATION-SMOKE: change WebChannel.send to ignore writer's return and
    // this fails on externalId.
  });

  it('propagates writer errors instead of swallowing them', async () => {
    const writer = vi.fn().mockRejectedValue(new Error('db down'));
    const ch = new WebChannel(writer);
    await expect(ch.send(PAYLOAD)).rejects.toThrow('db down');
  });
});

describe('SlackChannel', () => {
  it('maps payload fields onto postMessage', async () => {
    const postMessage = vi.fn().mockResolvedValue({ ok: true, ts: '1699999.001' });
    const ch = new SlackChannel(postMessage);
    const res = await ch.send(PAYLOAD);
    expect(res).toEqual({ ok: true, externalId: '1699999.001' });
    expect(postMessage).toHaveBeenCalledWith({
      channel: 'U123',
      text: 'hello world',
      blocks: PAYLOAD.blocks,
    });
  });

  it('returns ok:false with reason when Slack rejects', async () => {
    const postMessage = vi.fn().mockResolvedValue({ ok: false, error: 'channel_not_found' });
    const ch = new SlackChannel(postMessage);
    const res = await ch.send(PAYLOAD);
    expect(res).toEqual({ ok: false, reason: 'channel_not_found' });
  });

  it('omits blocks + metadata keys when the caller did not supply them', async () => {
    const postMessage = vi.fn().mockResolvedValue({ ok: true, ts: 't' });
    const ch = new SlackChannel(postMessage);
    await ch.send({ recipient: 'U9', plaintext_fallback: 'x' });
    const arg = postMessage.mock.calls[0][0];
    expect(arg).not.toHaveProperty('blocks');
    expect(arg).not.toHaveProperty('metadata');
  });
});

describe('WhatsAppChannel + DiscordChannel stubs', () => {
  it('throws NotImplementedError on send()', async () => {
    await expect(new WhatsAppChannel().send(PAYLOAD)).rejects.toBeInstanceOf(NotImplementedError);
    await expect(new DiscordChannel().send(PAYLOAD)).rejects.toBeInstanceOf(NotImplementedError);
    // Why-throw: silent no-ops would let a mis-wired feature flag ship without
    // the operator ever noticing user opt-in to a stubbed transport.
  });
});

describe('ChannelRegistry.sendAll', () => {
  it('fans out and reports per-channel results without cross-blocking', async () => {
    const reg = new ChannelRegistry();
    reg.register(new WebChannel(async () => 'w1'));
    reg.register(new SlackChannel(async () => ({ ok: true, ts: 's1' })));
    reg.register(new WhatsAppChannel()); // stub throws

    const results = await reg.sendAll(['web', 'slack', 'whatsapp', 'discord'], PAYLOAD);

    expect(results).toEqual([
      { kind: 'web', result: { ok: true, externalId: 'w1' } },
      { kind: 'slack', result: { ok: true, externalId: 's1' } },
      { kind: 'whatsapp', error: 'Channel "whatsapp" is a stub. Implement send() before use.' },
      { kind: 'discord', error: 'channel_not_registered' },
    ]);
    // MUTATION-SMOKE: swap the try/catch in sendAll for `await channel.send()`
    // (no catch) and the whatsapp throw kills the fan-out; discord line never
    // runs; this test fails.
  });
});

describe('channelsFor', () => {
  it('returns the per-event channel list or [] if the event is not set', () => {
    const prefs = {
      userId: 'u1',
      per_event: { daily_brief: ['web' as const, 'slack' as const] },
    };
    expect(channelsFor('daily_brief', prefs)).toEqual(['web', 'slack']);
    expect(channelsFor('job_match', prefs)).toEqual([]);
  });
});
