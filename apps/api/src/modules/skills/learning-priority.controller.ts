import { Controller, Get, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import { SessionService } from '../auth/session.service';
import { LearningPriorityService } from './learning-priority.service';

/**
 * C-P1.2c: dashboard-facing endpoints for the learning-priority ranking.
 * `GET /me/skills/learning-priority`         -> full ranked list
 * `GET /me/skills/learning-priority/:skillId` -> one row (404 if absent)
 *
 * The list is deliberately not paginated: 200 taxonomy rows fit in one
 * payload and the UI wants a scrollable "focus on these next" panel. Add
 * a `?limit=` param when the taxonomy grows past a few hundred rows.
 */
@Controller('me/skills/learning-priority')
export class LearningPriorityController {
  constructor(
    private readonly priorities: LearningPriorityService,
    private readonly session: SessionService,
  ) {}

  @Get()
  async list(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.priorities.rankFor(userId);
  }

  @Get(':skillId')
  async detail(@Param('skillId') skillId: string, @Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.priorities.detailFor(userId, skillId);
  }
}
