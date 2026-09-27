import { Injectable } from '@nestjs/common';
import type { JobPreferencesInput } from '@careeros/shared';
import { PrismaService } from '../../prisma/prisma.service';

export interface JobPreferencesDto extends JobPreferencesInput {
  updatedAt: string | null;
}

const EMPTY: JobPreferencesDto = {
  targetRoles: [],
  locations: [],
  remoteOnly: false,
  currency: 'USD',
  seniority: [],
  mustHaveSkills: [],
  dealbreakerSkills: [],
  companyBlacklist: [],
  updatedAt: null,
};

@Injectable()
export class JobPreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<JobPreferencesDto> {
    const row = await this.prisma.userJobPreferences.findUnique({ where: { userId } });
    if (!row) return EMPTY;
    return {
      targetRoles: row.targetRoles,
      locations: row.locations,
      remoteOnly: row.remoteOnly,
      compMin: row.compMin ?? undefined,
      compMax: row.compMax ?? undefined,
      currency: row.currency,
      seniority: row.seniority as JobPreferencesInput['seniority'],
      mustHaveSkills: row.mustHaveSkills,
      dealbreakerSkills: row.dealbreakerSkills,
      companyBlacklist: row.companyBlacklist,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async upsert(userId: string, input: JobPreferencesInput): Promise<JobPreferencesDto> {
    const compMin = input.compMin ?? null;
    const compMax = input.compMax ?? null;
    const data = {
      targetRoles: input.targetRoles,
      locations: input.locations,
      remoteOnly: input.remoteOnly,
      compMin,
      compMax,
      currency: input.currency,
      seniority: input.seniority,
      mustHaveSkills: input.mustHaveSkills,
      dealbreakerSkills: input.dealbreakerSkills,
      companyBlacklist: input.companyBlacklist,
    };
    await this.prisma.userJobPreferences.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return this.get(userId);
  }
}
