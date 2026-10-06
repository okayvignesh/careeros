import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import { SessionService } from '../auth/session.service';
import { RepositoryAnalysisService } from './repository-analysis.service';

@Controller('repository-analysis')
export class RepositoryAnalysisController {
  constructor(
    private readonly analysis: RepositoryAnalysisService,
    private readonly session: SessionService,
  ) {}

  @Get()
  async get(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.analysis.getAnalysis(userId);
  }
}
