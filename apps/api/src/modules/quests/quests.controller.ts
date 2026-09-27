import { BadRequestException, Controller, Get, Param, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { SessionService } from '../auth/session.service';
import { getUnmetPrereqs, getPrereqs } from './prereq-graph';
import {
  QuestGeneratorService,
  type Horizon,
} from './quest-generator.service';
import { LearningPriorityService } from '../skills/learning-priority.service';

/**
 * C-P2.6c: quest surfaces.
 *
 *   GET /me/quests?horizon=week|month|quarter -> planned quest list
 *   GET /me/quests/prereq/:skillId            -> unmet prereqs (from graph)
 */
@Controller('me/quests')
export class QuestsController {
  constructor(
    private readonly quests: QuestGeneratorService,
    private readonly priorities: LearningPriorityService,
    private readonly session: SessionService,
  ) {}

  @Get()
  async list(@Req() req: Request, @Query('horizon') horizon?: string) {
    const userId = this.session.requireUserId(req);
    const h = parseHorizon(horizon);
    return this.quests.plan(userId, h ? { targetHorizon: h } : {});
  }

  @Get('prereq/:skillId')
  async prereqs(@Req() req: Request, @Param('skillId') skillId: string) {
    const userId = this.session.requireUserId(req);
    // We need the user's mastered set to answer "unmet" honestly. Reuse the
    // ranking service; the "current" factor already carries proficiency.
    const ranked = await this.priorities.rankFor(userId);
    const mastered = new Set<string>();
    for (const r of ranked) {
      if (r.factors.current >= 0.7) mastered.add(r.skillId);
    }
    return {
      skillId,
      immediatePrereqs: getPrereqs(skillId),
      unmetPrereqs: getUnmetPrereqs(skillId, mastered),
    };
  }
}

function parseHorizon(raw: string | undefined): Horizon | null {
  if (!raw) return null;
  if (raw === 'week' || raw === 'month' || raw === 'quarter') return raw;
  throw new BadRequestException(
    `horizon must be one of week|month|quarter, got '${raw}'`,
  );
}
