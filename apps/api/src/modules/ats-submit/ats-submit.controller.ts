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

  /**
   * POST body: `{ applicationId, ats, jobBoardId, idempotencyKey? }`.
   *
   * F.1 wire: this endpoint ENQUEUES an approval item - the actual ATS POST
   * fires later from the approvals worker once the user approves. The 202
   * response carries the approval item id; clients poll /me/approvals/:id
   * or watch the SSE stream to see sent / failed.
   */
  @Post()
  @HttpCode(202)
  async enqueue(
    @Req() req: Request,
    @Body()
    body: {
      applicationId?: string;
      ats?: string;
      jobBoardId?: string;
      idempotencyKey?: string;
    },
  ): Promise<{ approvalItemId: string; state: string; kind: string }> {
    const userId = this.session.requireUserId(req);
    if (!body?.applicationId) throw new BadRequestException('applicationId required');
    if (!body?.ats || !ATS_IDS.has(body.ats as AtsId)) {
      throw new BadRequestException(`ats must be one of ${[...ATS_IDS].join(', ')}`);
    }
    if (!body?.jobBoardId) throw new BadRequestException('jobBoardId required');
    const input: Parameters<AtsSubmitService['enqueue']>[0] = {
      userId,
      applicationId: body.applicationId,
      ats: body.ats as AtsId,
      jobBoardId: body.jobBoardId,
    };
    if (body.idempotencyKey) input.idempotencyKey = body.idempotencyKey;
    const item = await this.submitter.enqueue(input);
    return { approvalItemId: item.id, state: item.state, kind: item.kind };
  }

  @Get()
  async list(@Req() req: Request, @Query('status') status: string | undefined) {
    const userId = this.session.requireUserId(req);
    return this.submitter.list(userId, status);
  }
}
