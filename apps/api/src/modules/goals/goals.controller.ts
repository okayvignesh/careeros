import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CareerGoalsSchema, type CareerGoalsInput } from '@careeros/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { SessionService } from '../auth/session.service';
import { GoalsService } from './goals.service';

@Controller('goals')
export class GoalsController {
  constructor(
    private readonly goals: GoalsService,
    private readonly session: SessionService,
  ) {}

  @Post()
  @HttpCode(201)
  async save(
    @Body(new ZodValidationPipe(CareerGoalsSchema)) body: CareerGoalsInput,
    @Req() req: Request,
  ) {
    const userId = this.session.requireUserId(req);
    return this.goals.save(userId, body);
  }
}
