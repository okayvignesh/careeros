// E.4: Gmail integration HTTP surface.
//
// Route layout intentionally mirrors the plan (§Wave E.4):
//
//   GET    /integrations/gmail/oauth/start     - auth-required
//   GET    /integrations/gmail/oauth/callback  - PUBLIC (no cookie; comes from Google)
//   POST   /webhooks/gmail/push                - PUBLIC (Pub/Sub push; verified via JWT)
//   DELETE /integrations/gmail                 - auth-required
//
// The webhook is deliberately at `/webhooks/gmail/push` and NOT under
// `/integrations/...` so the operator can pin per-webhook rate limits by path.
// F.11: 300 req/min per IP cap on the Pub/Sub push endpoint (Google Pub/Sub
// pushes come from a shared IP pool; 300/min is well above real traffic for a
// single-user deployment yet cheap enough to shed accidental floods before
// the JWT verify runs). The controller is safe to leave un-cookied because
// handlePubSubPush verifies the Google JWT before touching state (see
// gmail.service + gmail.jwt-verify).
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { SessionService } from '../auth/session.service';
import { GmailService, type PubSubEnvelope } from './gmail.service';
import { GmailOutboundService } from './gmail.outbound.service';

@Controller()
export class GmailController {
  constructor(
    private readonly gmail: GmailService,
    private readonly outbound: GmailOutboundService,
    private readonly session: SessionService,
  ) {}

  @Get('integrations/gmail/oauth/start')
  start(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.gmail.startOAuth(userId);
  }

  // Public: no @requireUserId — Google's redirect back to us won't carry a
  // session cookie in a form the browser trusts across the OAuth hop. The
  // `state` param carries the userId that started the flow and we cross-check
  // it against the current session cookie if one exists.
  @Get('integrations/gmail/oauth/callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (error) {
      res.status(400).send(`Gmail OAuth error: ${escapeHtml(error)}`);
      return;
    }
    if (!code || !state) {
      throw new BadRequestException('missing code or state');
    }
    const sealed = this.session.read(req);
    if (!sealed || sealed.userId !== state) {
      // Signed-out or state-swap. Refuse rather than silently binding the
      // grant to whoever happens to hold the cookie right now.
      throw new BadRequestException('oauth state mismatch');
    }
    const result = await this.gmail.finishOAuth(sealed.userId, code);
    // A browser returns from Google via a top-level GET (Accept: text/html);
    // send it back to the web UI so the operator sees a page, not raw JSON.
    // API clients keep the existing JSON shape.
    if (wantsHtml(req)) {
      res.redirect(302, webRedirect('/settings/integrations?connected=gmail'));
      return;
    }
    res.status(200).json({
      historyId: result.historyId,
      expiration: result.expiration.toISOString(),
    });
  }

  // Public webhook: Google Pub/Sub push subscription targets this URL.
  // gmail.service.handlePubSubPush verifies the JWT before doing anything;
  // 204 is returned on unknown-email / no-watch cases so Pub/Sub doesn't
  // retry indefinitely (retries would fire the JWT check every time for no
  // reason).
  @Post('webhooks/gmail/push')
  @HttpCode(204)
  // F.11: cap floods before JWT verify runs. Real Pub/Sub push traffic for a
  // single-user deployment sits well under 60/min; 300/min gives 5x headroom
  // for burst delivery on watch renewal + still sheds obvious floods.
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  async push(
    @Headers('authorization') authorization: string | undefined,
    @Body() envelope: PubSubEnvelope,
  ) {
    await this.gmail.handlePubSubPush(authorization, envelope);
  }

  @Delete('integrations/gmail')
  @HttpCode(204)
  async disconnect(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    await this.gmail.disconnect(userId);
  }

  /**
   * F.5: create a MIME draft. Body:
   *   { to, subject, body, threadId?, inReplyTo?, references?, idempotencyKey? }
   * Returns { draftId, messageId, threadId }. The outreach approval worker
   * calls the service directly; this route is for the web composer + replies.
   */
  @Post('integrations/gmail/drafts')
  @HttpCode(201)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async createDraft(
    @Req() req: Request,
    @Body() body: CreateDraftBody,
  ) {
    const userId = this.session.requireUserId(req);
    const input = parseDraftBody(body);
    return this.outbound.createDraft(userId, input);
  }

  /**
   * F.5: send. Body is either `{ draftId }` (send a staged draft) or a full
   * message `{ to, subject, body, threadId? }` (direct send after approval).
   */
  @Post('integrations/gmail/send')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async send(@Req() req: Request, @Body() body: SendBody) {
    const userId = this.session.requireUserId(req);
    if (typeof body?.draftId === 'string' && body.draftId.length > 0) {
      // `to` is optional on a draft send (the draft id is authoritative); when
      // supplied it names the recipient in the `gmail.sent` audit event.
      const recipient = typeof body.to === 'string' && body.to.length > 0 ? body.to : undefined;
      return this.outbound.sendDraft(userId, body.draftId, recipient ? { recipient } : {});
    }
    const input = parseDraftBody(body as CreateDraftBody);
    return this.outbound.sendMessage(userId, input);
  }
}

interface CreateDraftBody {
  to?: unknown;
  subject?: unknown;
  body?: unknown;
  threadId?: unknown;
  inReplyTo?: unknown;
  references?: unknown;
  idempotencyKey?: unknown;
}

interface SendBody extends CreateDraftBody {
  draftId?: unknown;
}

/**
 * Validate + narrow the draft/send request body at the HTTP boundary. Zod
 * would be the house default, but this is four fields inside the module that
 * already owns the shape; a typed guard avoids pulling zod into the controller
 * while still refusing anything malformed before the Gmail call.
 */
function parseDraftBody(body: CreateDraftBody): {
  to: string;
  subject: string;
  body: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string[];
  idempotencyKey?: string;
} {
  const to = str(body?.to, 'to');
  const subject = str(body?.subject, 'subject');
  const text = str(body?.body, 'body');
  const out: {
    to: string;
    subject: string;
    body: string;
    threadId?: string;
    inReplyTo?: string;
    references?: string[];
    idempotencyKey?: string;
  } = { to, subject, body: text };
  if (body.threadId !== undefined) out.threadId = str(body.threadId, 'threadId');
  if (body.inReplyTo !== undefined) out.inReplyTo = str(body.inReplyTo, 'inReplyTo');
  if (body.idempotencyKey !== undefined) {
    out.idempotencyKey = str(body.idempotencyKey, 'idempotencyKey');
  }
  if (body.references !== undefined) {
    if (!Array.isArray(body.references) || body.references.some((r) => typeof r !== 'string')) {
      throw new BadRequestException('references must be a string[]');
    }
    out.references = body.references as string[];
  }
  return out;
}

function str(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.trim().length === 0) {
    throw new BadRequestException(`${field} is required and must be a non-empty string`);
  }
  return v;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wantsHtml(req: Request): boolean {
  return req.headers.accept?.includes('text/html') ?? false;
}

// Relative when WEB_URL is unset (api + web share an origin behind nginx in
// production); absolute when set (local dev / split origins).
function webRedirect(path: string): string {
  return `${process.env.WEB_URL ?? ''}${path}`;
}
