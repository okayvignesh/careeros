// Events API dispatch. Signature verification + event_id dedupe live in
// slack.service / slack.controller; this service does the real work for the
// small set of events the app subscribes to. Today: `app_mention` and direct
// messages get a threaded reply with quick actions; everything else is audited
// as received-and-ignored so operators can see traffic without acting on it.
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SlackService } from './slack.service';
import { SlackContextService } from './slack.context';
import type { SlackBlock } from './slack.block-kit';

export interface SlackEventEnvelope {
  type: string;
  event_id?: string;
  team_id?: string;
  event?: {
    type?: string;
    subtype?: string;
    bot_id?: string;
    channel?: string;
    channel_type?: string;
    user?: string;
    text?: string;
    ts?: string;
    thread_ts?: string;
  };
}

export interface EventOutcome {
  handled: boolean;
  action: string;
}

@Injectable()
export class SlackEventsService {
  private readonly logger = new Logger(SlackEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly slack: SlackService,
    private readonly context: SlackContextService,
  ) {}

  async handle(envelope: SlackEventEnvelope): Promise<EventOutcome> {
    const event = envelope.event;
    if (!event?.type) return { handled: false, action: 'no_event' };

    // Ignore our own bot's messages to avoid a reply loop.
    if (event.bot_id || event.subtype === 'bot_message') {
      return { handled: false, action: 'ignored_bot' };
    }

    switch (event.type) {
      case 'app_mention':
        return this.replyWithActions(event, 'app_mention');
      case 'message':
        if (event.channel_type === 'im') return this.replyWithActions(event, 'direct_message');
        await this.audit(null, 'slack.event.received', { type: event.type, channel: event.channel });
        return { handled: false, action: 'ignored_message' };
      default:
        await this.audit(null, 'slack.event.received', { type: event.type });
        return { handled: false, action: 'ignored_type' };
    }
  }

  private async replyWithActions(
    event: NonNullable<SlackEventEnvelope['event']>,
    kind: string,
  ): Promise<EventOutcome> {
    const userId = await this.context.resolveUserId();
    if (!userId || !event.channel) {
      await this.audit(userId, 'slack.event.unroutable', { kind, channel: event.channel ?? null });
      return { handled: false, action: 'unroutable' };
    }
    const blocks: SlackBlock[] = [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: 'Here is what I can do from Slack right now:' },
      },
      {
        type: 'actions',
        block_id: 'brief_actions',
        elements: [
          {
            type: 'button',
            action_id: 'brief:show_jobs',
            text: { type: 'plain_text', text: 'Show jobs' },
            style: 'primary',
          },
          {
            type: 'button',
            action_id: 'brief:market_brief',
            text: { type: 'plain_text', text: 'Market brief' },
          },
          {
            type: 'button',
            action_id: 'brief:review_progress',
            text: { type: 'plain_text', text: 'Review progress' },
          },
        ],
      },
    ];
    const res = await this.slack.postMessage({
      channel: event.channel,
      text: 'Career OS quick actions',
      blocks,
      ...(event.ts ? { thread_ts: event.ts } : {}),
    });
    await this.audit(userId, 'slack.event.replied', {
      kind,
      channel: event.channel,
      ok: res.ok,
      ...(res.error ? { error: res.error } : {}),
    });
    return { handled: res.ok, action: kind };
  }

  private async audit(
    userId: string | null,
    action: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.auditEvent
      .create({
        data: {
          userId,
          actor: 'system',
          action,
          resourceType: 'slack',
          resourceId: null,
          payload: payload as never,
        },
      })
      .catch(() => undefined);
  }
}
