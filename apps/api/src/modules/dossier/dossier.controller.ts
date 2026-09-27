import { Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { SessionService } from '../auth/session.service';
import { DossierService } from './dossier.service';

@Controller('me/dossier')
export class DossierController {
  constructor(
    private readonly dossier: DossierService,
    private readonly session: SessionService,
  ) {}

  /**
   * Rebuild the dossier for `companyId` synchronously and return the fresh
   * dto. Returns a job-id-shaped payload so a future BullMQ-backed refresher
   * can swap in without changing the client contract.
   * ponytail: synchronous today. When a single assemble takes > a few seconds
   * (multiple RSS + reviews + LLM), move to a queued job and change this route
   * to return {jobId, status:'queued'} + a WSS event on completion.
   */
  @Post(':companyId/refresh')
  @HttpCode(202)
  async refresh(@Param('companyId') companyId: string, @Req() req: Request) {
    const userId = this.session.requireUserId(req);
    const dto = await this.dossier.assembleFor(userId, companyId);
    return { jobId: dto.id, status: 'complete', dossier: dto };
  }

  /** Return the cached dossier or 404. */
  @Get(':companyId')
  async get(@Param('companyId') companyId: string, @Req() req: Request) {
    this.session.requireUserId(req);
    return this.dossier.requireCached(companyId);
  }
}
