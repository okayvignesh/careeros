import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { SessionService } from '../auth/session.service';
import { OutreachService, type ComposeInput } from './outreach.service';

/**
 * F.5 endpoints.
 *
 *   POST /outreach                    body ComposeInput (returns draft)
 *   GET  /outreach?status=draft       list
 *   POST /outreach/:id/approve        transition draft -> approved
 *   POST /outreach/:id/sent           transition approved -> sent (body { gmailDraftId? })
 *   POST /outreach/:id/discard        soft delete (any state except sent)
 */
@Controller('outreach')
export class OutreachController {
  constructor(
    private readonly outreach: OutreachService,
    private readonly session: SessionService,
  ) {}

  @Post()
  @HttpCode(201)
  async compose(@Req() req: Request, @Body() body: Omit<ComposeInput, 'userId'>) {
    const userId = this.session.requireUserId(req);
    if (!body?.templateId || !body?.recipient?.email) {
      throw new BadRequestException('templateId and recipient.email required');
    }
    return this.outreach.compose({ ...body, userId });
  }

  @Get()
  async list(@Req() req: Request, @Query('status') status: string | undefined) {
    const userId = this.session.requireUserId(req);
    return this.outreach.list(userId, status);
  }

  @Post(':id/approve')
  @HttpCode(200)
  async approve(@Req() req: Request, @Param('id') id: string) {
    const userId = this.session.requireUserId(req);
    await this.outreach.approve(userId, id);
    return { ok: true };
  }

  @Post(':id/sent')
  @HttpCode(200)
  async markSent(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { gmailDraftId?: string },
  ) {
    const userId = this.session.requireUserId(req);
    await this.outreach.markSent(userId, id, body?.gmailDraftId);
    return { ok: true };
  }

  @Post(':id/discard')
  @HttpCode(200)
  async discard(@Req() req: Request, @Param('id') id: string) {
    const userId = this.session.requireUserId(req);
    await this.outreach.discard(userId, id);
    return { ok: true };
  }
}
