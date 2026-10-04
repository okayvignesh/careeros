import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SlackService } from './slack.service';
import type { SlackContextService } from './slack.context';
import { SlackEventsService } from './slack.events.service';

function build(postOk = true) {
  const prisma = {
    auditEvent: { create: vi.fn().mockResolvedValue({ id: 'a-1' }) },
  } as unknown as PrismaService;
  const postMessage = vi.fn().mockResolvedValue(postOk ? { ok: true, ts: '1.2' } : { ok: false, error: 'nope' });
  const slack = { postMessage } as unknown as SlackService;
  const context = { resolveUserId: vi.fn().mockResolvedValue('u-1') } as unknown as SlackContextService;
  return { svc: new SlackEventsService(prisma, slack, context), postMessage, prisma };
}

describe('SlackEventsService', () => {
  it('replies with quick actions on app_mention', async () => {
    const { svc, postMessage } = build();
    const out = await svc.handle({
      type: 'event_callback',
      event: { type: 'app_mention', channel: 'C1', ts: '1.0' },
    });
    expect(out).toMatchObject({ handled: true, action: 'app_mention' });
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'C1', thread_ts: '1.0' }),
    );
  });

  it('replies on direct messages', async () => {
    const { svc, postMessage } = build();
    const out = await svc.handle({
      type: 'event_callback',
      event: { type: 'message', channel_type: 'im', channel: 'D1', ts: '2.0' },
    });
    expect(out.action).toBe('direct_message');
    expect(postMessage).toHaveBeenCalledOnce();
  });

  it('ignores bot messages to avoid a reply loop', async () => {
    const { svc, postMessage } = build();
    const out = await svc.handle({
      type: 'event_callback',
      event: { type: 'message', bot_id: 'B1', channel: 'C1' },
    });
    expect(out).toMatchObject({ handled: false, action: 'ignored_bot' });
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('audits unknown events without acting', async () => {
    const { svc, prisma, postMessage } = build();
    const out = await svc.handle({ type: 'event_callback', event: { type: 'team_join' } });
    expect(out.handled).toBe(false);
    expect(postMessage).not.toHaveBeenCalled();
    expect(prisma.auditEvent.create).toHaveBeenCalled();
  });
});
