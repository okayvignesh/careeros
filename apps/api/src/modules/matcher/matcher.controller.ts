import { BadRequestException, Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { SessionService } from '../auth/session.service';
import { MatcherService } from './matcher.service';

@Controller('matcher')
export class MatcherController {
  constructor(
    private readonly matcher: MatcherService,
    private readonly session: SessionService,
  ) {}

  @Post('score')
  @HttpCode(200)
  async score(@Body() body: { jobId?: string }, @Req() req: Request) {
    const userId = this.session.requireUserId(req);
    if (typeof body.jobId !== 'string' || !body.jobId) {
      throw new BadRequestException('jobId is required');
    }
    return this.matcher.scoreJob(userId, body.jobId);
  }
}
