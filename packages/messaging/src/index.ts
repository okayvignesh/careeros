// E.9 (Wave E / P5): messaging Channel interface + built-in implementations.
//
// The Channel interface is the seam between "app decides a user should be
// notified" and "concrete transport gets the bytes on the wire". Every new
// transport implements Channel and is registered in a ChannelRegistry; the
// caller (daily-brief composer, quest reminder, application-update watcher)
// does not know or care which transports fire.
//
// Shipped:
//   - `WebChannel`  - in-app notification writer (persists to a callback the
//                     app supplies; keeps this package free of Prisma).
//   - `SlackChannel` - Slack-flavored delivery. Takes a `postMessage` function
//                     via constructor injection so this package stays
//                     transport-free (no @slack/web-api, no HTTP client
//                     leak). apps/api wires the real SlackService method
//                     into the constructor.
//   - `WhatsAppChannel` / `DiscordChannel` - stubs; `send()` throws
//                     `NotImplementedError`. Present so app-side code can
//                     already reference them by name (feature-flag off) and
//                     no core refactor is needed when they land.

export type ChannelKind = 'web' | 'slack' | 'whatsapp' | 'discord';

/**
 * The minimum every send needs: who it goes to, the plaintext fallback (used
 * when the transport can't render blocks, and shown in mobile push previews),
 * and optional structured `blocks` (Slack Block Kit-shaped; other transports
 * ignore or downgrade). `metadata` is a bag transports can stash their own
 * ids into so replies/reactions can be traced back later (persisted by the
 * caller if desired, not by this package).
 */
export interface SendPayload {
  recipient: string;
  plaintext_fallback: string;
  blocks?: unknown[];
  metadata?: Record<string, unknown>;
}

/**
 * Result of a send. `ok:false` means the transport ran but the recipient did
 * not receive (user has DND, channel muted, unknown user). Errors that mean
 * "retry with backoff" (network flap, 5xx) throw instead.
 */
export interface SendResult {
  ok: boolean;
  externalId?: string;
  reason?: string;
}

export interface Channel {
  readonly kind: ChannelKind;
  send(payload: SendPayload): Promise<SendResult>;
}

export class NotImplementedError extends Error {
  constructor(channel: ChannelKind) {
    super(`Channel "${channel}" is a stub. Implement send() before use.`);
    this.name = 'NotImplementedError';
  }
}

/**
 * Web channel: an in-app notification. Delegates persistence to a caller-
 * supplied writer so this package stays free of Prisma / storage details.
 * The writer receives (userId, payload) and returns the created row id
 * (used as `externalId`). If the writer throws, send throws.
 */
export type WebNotificationWriter = (
  userId: string,
  payload: SendPayload,
) => Promise<string>;

export class WebChannel implements Channel {
  readonly kind: ChannelKind = 'web';
  constructor(private readonly writer: WebNotificationWriter) {}

  async send(payload: SendPayload): Promise<SendResult> {
    const id = await this.writer(payload.recipient, payload);
    return { ok: true, externalId: id };
  }
}

/**
 * Slack channel. Takes a `postMessage` function via constructor injection so
 * this package does not need an @slack/web-api dep. apps/api wires a real
 * postMessage that hits slack.com/api/chat.postMessage using the bot token
 * stashed in EncryptedSecret at OAuth completion.
 *
 * `recipient` is a Slack channel-id or user-id (Slack's chat.postMessage
 * accepts both, DM channels are opened lazily). `blocks` are passed through
 * as-is; the caller uses slack.block-kit.ts to build them.
 */
export type SlackPostMessage = (args: {
  channel: string;
  text: string;
  blocks?: unknown[];
  metadata?: Record<string, unknown>;
}) => Promise<{ ok: boolean; ts?: string; error?: string }>;

export class SlackChannel implements Channel {
  readonly kind: ChannelKind = 'slack';
  constructor(private readonly postMessage: SlackPostMessage) {}

  async send(payload: SendPayload): Promise<SendResult> {
    const res = await this.postMessage({
      channel: payload.recipient,
      text: payload.plaintext_fallback,
      ...(payload.blocks ? { blocks: payload.blocks } : {}),
      ...(payload.metadata ? { metadata: payload.metadata } : {}),
    });
    if (!res.ok) {
      return { ok: false, reason: res.error ?? 'slack_post_failed' };
    }
    return res.ts !== undefined ? { ok: true, externalId: res.ts } : { ok: true };
  }
}

/**
 * WhatsApp stub. Blueprint §11.4 flags this for later. Present so callers
 * can reference the class by name (feature-flag OFF) and no core refactor
 * lands when the real transport ships.
 * ponytail: stub raises; do NOT silently drop or the operator will never
 * discover a mis-wired feature flag.
 */
export class WhatsAppChannel implements Channel {
  readonly kind: ChannelKind = 'whatsapp';
  async send(_payload: SendPayload): Promise<SendResult> {
    throw new NotImplementedError('whatsapp');
  }
}

export class DiscordChannel implements Channel {
  readonly kind: ChannelKind = 'discord';
  async send(_payload: SendPayload): Promise<SendResult> {
    throw new NotImplementedError('discord');
  }
}

/**
 * Registry. Lets callers say "send to whichever channels the user has opted
 * into" without knowing which classes back them. `sendAll` fans out; per-
 * channel failures don't block the others (returns a per-channel result).
 * ponytail: no p-limit or backoff; if a channel is slow the whole fan-out
 * blocks. Add per-channel timeout when a slow transport actually bites.
 */
export class ChannelRegistry {
  private readonly channels = new Map<ChannelKind, Channel>();

  register(channel: Channel): void {
    this.channels.set(channel.kind, channel);
  }

  get(kind: ChannelKind): Channel | undefined {
    return this.channels.get(kind);
  }

  has(kind: ChannelKind): boolean {
    return this.channels.has(kind);
  }

  async sendAll(
    kinds: readonly ChannelKind[],
    payload: SendPayload,
  ): Promise<Array<{ kind: ChannelKind; result?: SendResult; error?: string }>> {
    const out: Array<{ kind: ChannelKind; result?: SendResult; error?: string }> = [];
    for (const kind of kinds) {
      const channel = this.channels.get(kind);
      if (!channel) {
        out.push({ kind, error: 'channel_not_registered' });
        continue;
      }
      try {
        const result = await channel.send(payload);
        out.push({ kind, result });
      } catch (err) {
        out.push({ kind, error: (err as Error).message });
      }
    }
    return out;
  }
}

/**
 * User preferences per event class. Which channels does the user want a
 * given event on? Callers keep the persisted preference row and pass it to
 * `channelsFor(event, prefs)` to get the list to feed into `sendAll`.
 * ponytail: no defaults here; the caller decides. Blueprint §11.4 lists the
 * event classes (daily brief, quest reminder, job match, application update).
 */
export type EventClass =
  | 'daily_brief'
  | 'quest_reminder'
  | 'job_match'
  | 'application_update';

export interface UserChannelPreferences {
  readonly userId: string;
  readonly per_event: Partial<Record<EventClass, ChannelKind[]>>;
}

export function channelsFor(
  event: EventClass,
  prefs: UserChannelPreferences,
): ChannelKind[] {
  return prefs.per_event[event] ?? [];
}
