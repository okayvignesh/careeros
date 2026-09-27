import { Controller, Get, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import { SessionService } from '../auth/session.service';
import { SkillsService } from './skills.service';

@Controller('me/skills')
export class SkillsController {
  constructor(
    private readonly skills: SkillsService,
    private readonly session: SessionService,
  ) {}

  @Get()
  async list(@Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.skills.list(userId);
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Req() req: Request) {
    const userId = this.session.requireUserId(req);
    return this.skills.detail(userId, id);
  }
}
