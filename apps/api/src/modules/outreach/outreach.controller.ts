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
 * F.5 endpoints. Every outbound message is gated by the approval queue: the
 * client composes (draft), requests approval (a pending `outreach_email`
 * item), the user approves it in the queue, and only then is a Gmail draft
 * staged. `send` flushes that staged draft.
 *
 *   POST /outreach                     body ComposeInput (returns draft)
 *   GET  /outreach?status=draft        list
 *   GET  /outreach/:id                 one row
 *   POST /outreach/:id/approve         enqueue an outreach_email approval
 *   POST /outreach/:id/send            send the staged Gmail draft
 *   POST /outreach/:id/discard         soft delete + cancel pending approval
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

  @Get(':id')
  async get(@Req() req: Request, @Param('id') id: string) {
    const userId = this.session.requireUserId(req);
    const row = await this.outreach.getById(userId, id);
    return row;
  }

  @Post(':id/approve')
  @HttpCode(200)
  async approve(@Req() req: Request, @Param('id') id: string) {
    const userId = this.session.requireUserId(req);
    return this.outreach.requestApproval(userId, id);
  }

  @Post(':id/send')
  @HttpCode(200)
  async send(@Req() req: Request, @Param('id') id: string) {
    const userId = this.session.requireUserId(req);
    return this.outreach.send(userId, id);
  }

  @Post(':id/discard')
  @HttpCode(200)
  async discard(@Req() req: Request, @Param('id') id: string) {
    const userId = this.session.requireUserId(req);
    await this.outreach.discard(userId, id);
    return { ok: true };
  }
}
