import { Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { SessionService } from '../auth/session.service';
import { CorpusService } from './corpus.service';

/**
 * Corpus admin endpoints. Slice-12 walking-skeleton: any signed-in user can
 * trigger a sync — single-user default deployment makes an admin role
 * premature. Multi-user hardening lands with the auth module's role system.
 */
@Controller('admin/corpus')
export class CorpusController {
  constructor(
    private readonly corpus: CorpusService,
    private readonly session: SessionService,
  ) {}

  @Get('adapters')
  list(@Req() req: Request) {
    this.session.requireUserId(req);
    return this.corpus.listAdapters();
  }

  @Post('sync/:adapter')
  @HttpCode(200)
  async sync(@Param('adapter') adapterId: string, @Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.corpus.sync(userId, adapterId);
  }
}
