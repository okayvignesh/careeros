import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { SessionService } from '../auth/session.service';
import { AtsSubmitService, type AtsId } from './ats-submit.service';

const ATS_IDS = new Set<AtsId>(['ashby', 'greenhouse']);

@Controller('ats-submit')
export class AtsSubmitController {
  constructor(
    private readonly submitter: AtsSubmitService,
    private readonly session: SessionService,
  ) {}

  /** POST body: { applicationId, ats, jobBoardId, idempotencyKey? } */
  @Post()
  @HttpCode(200)
  async submit(
    @Req() req: Request,
    @Body()
    body: {
      applicationId?: string;
      ats?: string;
      jobBoardId?: string;
      idempotencyKey?: string;
    },
  ) {
    const userId = this.session.requireUserId(req);
    if (!body?.applicationId) throw new BadRequestException('applicationId required');
    if (!body?.ats || !ATS_IDS.has(body.ats as AtsId)) {
      throw new BadRequestException(`ats must be one of ${[...ATS_IDS].join(', ')}`);
    }
    if (!body?.jobBoardId) throw new BadRequestException('jobBoardId required');
    const input: Parameters<AtsSubmitService['submit']>[0] = {
      userId,
      applicationId: body.applicationId,
      ats: body.ats as AtsId,
      jobBoardId: body.jobBoardId,
    };
    if (body.idempotencyKey) input.idempotencyKey = body.idempotencyKey;
    return this.submitter.submit(input);
  }

  @Get()
  async list(@Req() req: Request, @Query('status') status: string | undefined) {
    const userId = this.session.requireUserId(req);
    return this.submitter.list(userId, status);
  }
}
