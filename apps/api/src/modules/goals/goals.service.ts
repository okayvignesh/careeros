import { Injectable } from '@nestjs/common';
import type { CareerGoalsInput } from '@careeros/shared';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class GoalsService {
  constructor(private readonly prisma: PrismaService) {}

  async save(userId: string, input: CareerGoalsInput) {
    const data = {
      userId,
      targetRoles: input.targetRoles,
      locations: input.locations,
      remoteOnly: input.remoteOnly,
      compMin: input.compMin ?? null,
      compMax: input.compMax ?? null,
      currency: input.currency,
      seniority: input.seniority,
      timezone: input.timezone,
    };
    return this.prisma.careerGoal.upsert({
      where: { userId },
      create: data,
      update: data,
    });
  }
}
