import { BadRequestException, Controller, Get, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { SENSITIVITY_LEVELS, type Sensitivity } from '@careeros/ai';
import { SessionService } from '../auth/session.service';
import { SearchService } from './search.service';

@Controller('me/search')
export class SearchController {
  constructor(
    private readonly search: SearchService,
    private readonly session: SessionService,
  ) {}

  @Get()
  async query(
    @Query('q') q: string | undefined,
    @Query('collection') collection: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('maxSensitivity') maxSensitivity: string | undefined,
    @Req() req: Request,
  ) {
    const userId = this.session.requireUserId(req);
    const opts: {
      collection?: string;
      limit?: number;
      maxSensitivity?: Sensitivity;
    } = {};
    if (collection) opts.collection = collection;
    if (limit) {
      const n = Number(limit);
      if (!Number.isFinite(n) || n <= 0) {
        throw new BadRequestException('limit must be a positive number.');
      }
      opts.limit = n;
    }
    if (maxSensitivity) {
      if (!SENSITIVITY_LEVELS.includes(maxSensitivity as Sensitivity)) {
        throw new BadRequestException(
          `maxSensitivity must be one of ${SENSITIVITY_LEVELS.join(', ')}.`,
        );
      }
      opts.maxSensitivity = maxSensitivity as Sensitivity;
    }
    return this.search.search(userId, q ?? '', opts);
  }
}
