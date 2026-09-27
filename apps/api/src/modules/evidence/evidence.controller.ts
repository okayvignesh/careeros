import { Controller, Get, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { SessionService } from '../auth/session.service';
import { EvidenceService } from './evidence.service';

@Controller('me/evidence')
export class EvidenceController {
  constructor(
    private readonly evidence: EvidenceService,
    private readonly session: SessionService,
  ) {}

  @Get()
  async list(
    @Query('kind') kind: string | undefined,
    @Query('signal') signal: string | undefined,
    @Query('skillId') skillId: string | undefined,
    @Query('sinceDays') sinceDays: string | undefined,
    @Query('limit') limit: string | undefined,
    @Req() req: Request,
  ) {
    const userId = this.session.requireUserId(req);
    const q: import('./evidence.service').EvidenceQuery = { limit: limit ? Number(limit) : 100 };
    if (kind) q.kinds = kind.split(',').filter(Boolean);
    if (signal) q.signals = signal.split(',').filter(Boolean);
    if (skillId) q.skillId = skillId;
    if (sinceDays) q.sinceDays = Number(sinceDays);
    return this.evidence.list(userId, q);
  }

  @Get('facets')
  async facets(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.evidence.facets(userId);
  }
}
