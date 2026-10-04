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
    const goal = await this.prisma.careerGoal.upsert({
      where: { userId },
      create: data,
      update: data,
    });
    // P1 §4: the wizard keeps writing CareerGoal, but targeting now reads the
    // canonical `UserJobPreferences`. Write-through the scalar targeting fields
    // so a goal set in the wizard is immediately usable; structured geo fields
    // (countries/cities/authorizations) are owned by the settings panel.
    await this.prisma.userJobPreferences.upsert({
      where: { userId },
      create: {
        userId,
        targetRoles: input.targetRoles,
        locations: input.locations,
        remoteOnly: input.remoteOnly,
        compMin: input.compMin ?? null,
        compMax: input.compMax ?? null,
        currency: input.currency,
        seniority: input.seniority,
      },
      update: {
        targetRoles: input.targetRoles,
        locations: input.locations,
        remoteOnly: input.remoteOnly,
        compMin: input.compMin ?? null,
        compMax: input.compMax ?? null,
        currency: input.currency,
        seniority: input.seniority,
      },
    });
    return goal;
  }
}
