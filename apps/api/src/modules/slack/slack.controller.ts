// Slack webhook endpoints. Every route verifies the HMAC signature FIRST,
// before parsing the body at any semantic level. `req.rawBody` (populated by
// NestFactory `rawBody: true` in main.ts) is the exact bytes Slack signed.
//
// Endpoints:
//   POST /webhooks/slack/events        - Events API (JSON)
//   POST /webhooks/slack/interactive   - Interactive payloads (urlencoded)
//   POST /webhooks/slack/commands      - Slash commands (urlencoded)
//   GET  /webhooks/slack/oauth/start   - Begin install (auth required, state)
//   POST /webhooks/slack/oauth/callback - OAuth completion (query string)
//
// ponytail: one controller. Slack could get its own module per endpoint but
// four handlers in 150 lines is not a module split, it's four handlers.
import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { SessionService } from '../auth/session.service';
import { SlackService } from './slack.service';
import { SlackOAuthService, type SlackOAuthResult } from './slack.oauth';
import { SlackCommandsService } from './slack.commands.service';
import { SlackEventsService, type SlackEventEnvelope } from './slack.events.service';
import { SlackInteractiveService, type SlackInteractivePayload } from './slack.interactive.service';
import {
  dispatchSlash,
  type SlackSlashPayload,
  type SlashCommand,
} from './slack.slash-commands';
import { ephemeralText, type SlackMessage } from './slack.block-kit';

const SIG_HEADER = 'x-slack-signature';
const TS_HEADER = 'x-slack-request-timestamp';

// Slack's Events API retries; these caps shed a misbehaving caller before the
// HMAC verify runs while staying far above real traffic for a single install.
const WEBHOOK_LIMIT = { default: { limit: 120, ttl: 60_000 } };

@Controller('webhooks/slack')
export class SlackController {
  private readonly logger = new Logger(SlackController.name);

  constructor(
    private readonly slack: SlackService,
    private readonly oauth: SlackOAuthService,
    private readonly session: SessionService,
    private readonly commandsService: SlackCommandsService,
    private readonly eventsService: SlackEventsService,
    private readonly interactiveService: SlackInteractiveService,
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
  @Throttle(WEBHOOK_LIMIT)
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
    const outcome = await this.eventsService.handle((body ?? {}) as unknown as SlackEventEnvelope);
    return { ok: true, ...outcome };
  }

  /**
   * Interactive Block Kit callbacks. Slack sends `payload=<url-encoded JSON>`
   * inside an `application/x-www-form-urlencoded` body. Action ids route to
   * real handlers (assessment / job / approval / brief prefixes).
   */
  @Post('interactive')
  @HttpCode(200)
  @Throttle(WEBHOOK_LIMIT)
  async interactive(@Req() req: Request): Promise<SlackMessage | Record<string, unknown>> {
    this.verifyOrReject(req);
    const form = new URLSearchParams(this.rawString(req));
    const raw = form.get('payload');
    if (!raw) return { ok: true };
    const parsed = safeJson(raw) as unknown as SlackInteractivePayload | null;
    if (!parsed) return ephemeralText('Could not parse that interaction.');
    return this.interactiveService.handle(parsed);
  }

  /**
   * Slash commands. Body is urlencoded. Response goes back inline as a Block
   * Kit message (ephemeral by default per Slack's spec).
   */
  @Post('commands')
  @HttpCode(200)
  @Throttle(WEBHOOK_LIMIT)
  async commands(@Req() req: Request): Promise<SlackMessage> {
    this.verifyOrReject(req);
    const form = new URLSearchParams(this.rawString(req));
    const triggerId = form.get('trigger_id');
    const responseUrl = form.get('response_url');
    const payload: SlackSlashPayload = {
      command: (form.get('command') ?? '') as SlashCommand,
      text: form.get('text') ?? '',
      user_id: form.get('user_id') ?? '',
      channel_id: form.get('channel_id') ?? '',
      team_id: form.get('team_id') ?? '',
      ...(triggerId === null ? {} : { trigger_id: triggerId }),
      ...(responseUrl === null ? {} : { response_url: responseUrl }),
    };
    return dispatchSlash(payload, this.commandsService.router());
  }

  /**
   * Begin the install. Auth-required: the caller is the operator's signed-in
   * browser. Mints a one-time `state` bound to this user and returns the Slack
   * authorize URL carrying it. The state is the CSRF defence for the callback.
   */
  @Get('oauth/start')
  async oauthStart(@Req() req: Request): Promise<{ url: string }> {
    const userId = this.session.requireUserId(req);
    const clientId = process.env.SLACK_CLIENT_ID;
    const redirectUri = process.env.SLACK_OAUTH_REDIRECT_URI;
    if (!clientId || !redirectUri) {
      throw new HttpException('slack oauth not configured', HttpStatus.INTERNAL_SERVER_ERROR);
    }
    const state = await this.slack.createOAuthState(userId);
    const url = `https://slack.com/oauth/v2/authorize?${new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
    }).toString()}`;
    return { url };
  }

  /**
   * OAuth completion for API clients (JSON). NOT signature-verified - the
   * `code` proves possession. Defence is session + one-time server-issued
   * `state`: see `runOAuthCallback`.
   */
  @Post('oauth/callback')
  @HttpCode(200)
  async oauthCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const result = await this.runOAuthCallback(code, state, req);
    return { ok: true, team: { id: result.teamId, name: result.teamName }, scopes: result.scopes };
  }

  /**
   * OAuth completion for the browser hop: Slack redirects the user's browser
   * here with a top-level GET (`?code=...&state=...`). Same session + one-time
   * state checks as the POST; on success we 302 to the web settings page
   * (rather than handing a browser JSON), and on failure we land back there
   * with `?error=slack` so the operator still sees a page.
   */
  @Get('oauth/callback')
  async oauthCallbackBrowser(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (error) {
      res.redirect(302, this.webRedirect('/settings/integrations?error=slack'));
      return;
    }
    try {
      await this.runOAuthCallback(code, state, req);
    } catch (e) {
      this.logger.warn(`slack oauth callback rejected: ${(e as Error).message}`);
      res.redirect(302, this.webRedirect('/settings/integrations?error=slack'));
      return;
    }
    res.redirect(302, this.webRedirect('/settings/integrations?connected=slack'));
  }

  // ---- privates ----

  /**
   * Shared OAuth completion. NOT signature-verified - the `code` proves
   * possession. Defence is session + one-time server-issued `state`: the
   * caller must be signed in, hold the state minted for that same user, and
   * not have replayed it. `redirect_uri` is always the server-configured
   * registered value; a caller-supplied value is ignored so an attacker
   * cannot redirect the code exchange.
   */
  private async runOAuthCallback(
    code: string | undefined,
    state: string | undefined,
    req: Request,
  ): Promise<SlackOAuthResult> {
    if (!code) throw new BadRequestException('missing code');
    if (!state) throw new BadRequestException('missing state');
    const session = this.session.read(req);
    if (!session) throw new BadRequestException('oauth state mismatch');
    const redirectUri = process.env.SLACK_OAUTH_REDIRECT_URI ?? '';
    if (!redirectUri) throw new BadRequestException('missing redirect_uri');
    const valid = await this.slack.consumeOAuthState(state, session.userId);
    if (!valid) throw new BadRequestException('oauth state mismatch');
    return this.oauth.completeInstall(code, redirectUri, session.userId);
  }

  // Relative when WEB_URL is unset (api + web share an origin behind nginx in
  // production); absolute when set (local dev / split origins).
  private webRedirect(path: string): string {
    return `${process.env.WEB_URL ?? ''}${path}`;
  }

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
