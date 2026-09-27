// Slack webhook endpoints. Every route verifies the HMAC signature FIRST,
// before parsing the body at any semantic level. `req.rawBody` (populated by
// NestFactory `rawBody: true` in main.ts) is the exact bytes Slack signed.
//
// Endpoints:
//   POST /webhooks/slack/events        - Events API (JSON)
//   POST /webhooks/slack/interactive   - Interactive payloads (urlencoded)
//   POST /webhooks/slack/commands      - Slash commands (urlencoded)
//   POST /webhooks/slack/oauth/callback - OAuth completion (query string)
//
// ponytail: one controller. Slack could get its own module per endpoint but
// four handlers in 150 lines is not a module split, it's four handlers.
import {
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { SlackService } from './slack.service';
import { SlackOAuthService } from './slack.oauth';
import {
  dispatchSlash,
  type SlackSlashPayload,
  type SlashCommand,
} from './slack.slash-commands';
import { ephemeralText, type SlackMessage } from './slack.block-kit';

const SIG_HEADER = 'x-slack-signature';
const TS_HEADER = 'x-slack-request-timestamp';

@Controller('webhooks/slack')
export class SlackController {
  private readonly logger = new Logger(SlackController.name);

  constructor(
    private readonly slack: SlackService,
    private readonly oauth: SlackOAuthService,
  ) {}

  /**
   * Events API. Handles URL verification challenge on setup, then dispatches
   * `event_callback` payloads. Deduped by `event_id` (24h Redis TTL).
   *
   * Returns 200 with the challenge value on `url_verification`, `{ ok: true }`
   * otherwise. Slack considers any non-2xx a delivery failure and retries.
   */
  @Post('events')
  @HttpCode(200)
  async events(@Req() req: Request): Promise<Record<string, unknown>> {
    this.verifyOrReject(req);
    const body = safeJson(this.rawString(req));

    // Slack's initial handshake. Reply with the challenge, no dedupe needed.
    if (body?.type === 'url_verification' && typeof body.challenge === 'string') {
      return { challenge: body.challenge };
    }

    // event_callback payloads carry a unique event_id.
    const eventId = typeof body?.event_id === 'string' ? body.event_id : null;
    if (eventId) {
      const first = await this.slack.markEvent(eventId);
      if (!first) {
        this.logger.debug(`dedupe drop: ${eventId}`);
        return { ok: true, dedup: true };
      }
    }
    // ponytail: real event dispatch lands in stream E.5 (email classifier /
    // brief scheduler). Signature + dedupe are the load-bearing parts here.
    return { ok: true };
  }

  /**
   * Interactive Block Kit callbacks. Slack sends `payload=<url-encoded JSON>`
   * inside an `application/x-www-form-urlencoded` body.
   */
  @Post('interactive')
  @HttpCode(200)
  async interactive(@Req() req: Request): Promise<SlackMessage | Record<string, unknown>> {
    this.verifyOrReject(req);
    const form = new URLSearchParams(this.rawString(req));
    const raw = form.get('payload');
    if (!raw) return { ok: true };
    const parsed = safeJson(raw) as { actions?: Array<{ action_id?: string }> } | null;
    const actionId = parsed?.actions?.[0]?.action_id ?? '';
    this.logger.debug(`interactive action: ${actionId}`);
    // Ack with an ephemeral so the user sees a receipt; downstream services
    // wire real handlers keyed on action_id prefixes (assessment: / job: /
    // approval: / brief:).
    return ephemeralText(`Received: ${actionId || 'unknown_action'}`);
  }

  /**
   * Slash commands. Body is urlencoded. Response goes back inline as a Block
   * Kit message (ephemeral by default per Slack's spec).
   */
  @Post('commands')
  @HttpCode(200)
  async commands(@Req() req: Request): Promise<SlackMessage> {
    this.verifyOrReject(req);
    const form = new URLSearchParams(this.rawString(req));
    const payload: SlackSlashPayload = {
      command: (form.get('command') ?? '') as SlashCommand,
      text: form.get('text') ?? '',
      user_id: form.get('user_id') ?? '',
      channel_id: form.get('channel_id') ?? '',
      team_id: form.get('team_id') ?? '',
      trigger_id: form.get('trigger_id') ?? undefined,
      response_url: form.get('response_url') ?? undefined,
    };
    return dispatchSlash(payload);
  }

  /**
   * OAuth completion. Slack redirects the operator's browser here with a
   * `code`. NOT signature-verified (OAuth codes prove possession themselves).
   */
  @Post('oauth/callback')
  @HttpCode(200)
  async oauthCallback(
    @Query('code') code: string | undefined,
    @Query('redirect_uri') redirectUri: string | undefined,
  ): Promise<Record<string, unknown>> {
    if (!code) throw new HttpException('missing code', HttpStatus.BAD_REQUEST);
    const target = redirectUri ?? process.env.SLACK_OAUTH_REDIRECT_URI ?? '';
    if (!target) throw new HttpException('missing redirect_uri', HttpStatus.BAD_REQUEST);
    const result = await this.oauth.completeInstall(code, target);
    return { ok: true, team: { id: result.teamId, name: result.teamName }, scopes: result.scopes };
  }

  // ---- privates ----

  /**
   * Verify signature FIRST. Any failure throws an HttpException; no downstream
   * parsing happens.
   *
   * Note: extracts the raw body string via `req.rawBody` (Nest populates when
   * `rawBody: true` is set on NestFactory). Falls back to an empty string,
   * which will never validate against a real Slack signature.
   */
  private verifyOrReject(req: Request): void {
    const rawBody = this.rawString(req);
    const sig = req.header(SIG_HEADER);
    const ts = req.header(TS_HEADER);
    const result = this.slack.verify(rawBody, sig, ts);
    if (!result.ok) {
      this.logger.warn(`slack signature reject: ${result.reason}`);
      throw new HttpException(
        { message: 'invalid slack signature', reason: result.reason },
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  private rawString(req: Request): string {
    // Nest populates `req.rawBody` as a Buffer when `rawBody: true` is set.
    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    return raw ? raw.toString('utf8') : '';
  }
}

// Small helper: parse JSON without throwing (returns null on failure).
function safeJson(s: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(s);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
