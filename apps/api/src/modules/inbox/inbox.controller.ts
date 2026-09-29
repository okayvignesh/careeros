import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { SessionService } from '../auth/session.service';
import { InboxService } from './inbox.service';

@Controller('inbox')
export class InboxController {
  constructor(
    private readonly inbox: InboxService,
    private readonly session: SessionService,
  ) {}

  @Get()
  async list(
    @Req() req: Request,
    @Query('status') status: string | undefined,
    @Query('class') classFilter: string | undefined,
    @Query('limit') limitRaw: string | undefined,
  ) {
    const userId = this.session.requireUserId(req);
    const filter: { status?: string; classFilter?: string; limit?: number } = {};
    if (status) filter.status = status;
    if (classFilter) filter.classFilter = classFilter;
    if (limitRaw !== undefined) {
      const parsed = Number(limitRaw);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new BadRequestException('limit must be a positive number');
      }
      filter.limit = parsed;
    }
    return this.inbox.list(userId, filter);
  }

  @Post(':id/link')
  @HttpCode(200)
  async link(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { applicationId?: string },
  ) {
    const userId = this.session.requireUserId(req);
    if (!body?.applicationId) throw new BadRequestException('applicationId required');
    await this.inbox.linkManual(userId, id, body.applicationId);
    return { ok: true };
  }

  @Delete(':id/link')
  @HttpCode(204)
  async unlink(@Req() req: Request, @Param('id') id: string) {
    const userId = this.session.requireUserId(req);
    await this.inbox.unlink(userId, id);
  }

  @Post(':id/dismiss')
  @HttpCode(204)
  async dismiss(@Req() req: Request, @Param('id') id: string) {
    const userId = this.session.requireUserId(req);
    await this.inbox.dismiss(userId, id);
  }
}
