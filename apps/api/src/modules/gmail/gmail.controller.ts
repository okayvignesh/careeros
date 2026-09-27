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
// `/integrations/...` so the operator can pin per-webhook rate limits by path
// (Wave F.11 will hang a `requireAdmin` guard + rate-limit on this path). It
// is safe to leave un-cookied because handlePubSubPush verifies the Google
// JWT before doing anything (see gmail.service + gmail.jwt-verify).
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
import type { Request, Response } from 'express';
import { SessionService } from '../auth/session.service';
import { GmailService, type PubSubEnvelope } from './gmail.service';

@Controller()
export class GmailController {
  constructor(
    private readonly gmail: GmailService,
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
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
