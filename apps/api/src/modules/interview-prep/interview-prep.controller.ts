import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { SessionService } from '../auth/session.service';
import { InterviewPrepService } from './interview-prep.service';

/**
 * F.4 endpoints.
 *
 *   POST /interview-prep/:applicationId              generate plan
 *   GET  /interview-prep/:applicationId              read plan + talk-tracks
 *   POST /interview-prep/:applicationId/talk-tracks  body { topicId }
 */
@Controller('interview-prep')
export class InterviewPrepController {
  constructor(
    private readonly prep: InterviewPrepService,
    private readonly session: SessionService,
  ) {}

  @Post(':applicationId')
  @HttpCode(200)
  async generate(@Req() req: Request, @Param('applicationId') applicationId: string) {
    const userId = this.session.requireUserId(req);
    return this.prep.generatePlan(userId, applicationId);
  }

  @Get(':applicationId')
  async get(@Req() req: Request, @Param('applicationId') applicationId: string) {
    const userId = this.session.requireUserId(req);
    return this.prep.get(userId, applicationId);
  }

  @Post(':applicationId/talk-tracks')
  @HttpCode(200)
  async talkTrack(
    @Req() req: Request,
    @Param('applicationId') applicationId: string,
    @Body() body: { topicId?: string },
  ) {
    const userId = this.session.requireUserId(req);
    if (!body?.topicId) throw new BadRequestException('topicId required');
    return this.prep.generateTalkTrack(userId, applicationId, body.topicId);
  }
}
