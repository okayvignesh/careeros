import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { JobPreferencesInput, JobPreferenceCity } from '@careeros/shared';
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
  workplaceTypes: [],
  remoteScopes: [],
  countries: [],
  cities: [],
  citizenships: [],
  workAuthorizations: [],
  sponsorshipCountries: [],
  relocationWilling: false,
  relocationCountries: [],
  language: 'en',
  updatedAt: null,
};

function upperAll(values: string[]): string[] {
  return values.map((v) => v.toUpperCase());
}

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
      workplaceTypes: row.workplaceTypes as JobPreferencesInput['workplaceTypes'],
      remoteScopes: row.remoteScopes as JobPreferencesInput['remoteScopes'],
      countries: row.countries,
      cities: (row.cities as unknown as JobPreferenceCity[] | null) ?? [],
      ...(row.homeCountry ? { homeCountry: row.homeCountry } : {}),
      citizenships: row.citizenships,
      workAuthorizations: row.workAuthorizations,
      sponsorshipCountries: row.sponsorshipCountries,
      relocationWilling: row.relocationWilling,
      relocationCountries: row.relocationCountries,
      ...(row.timezoneOverlapHours != null
        ? { timezoneOverlapHours: row.timezoneOverlapHours }
        : {}),
      language: row.language ?? 'en',
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
      workplaceTypes: input.workplaceTypes,
      remoteScopes: input.remoteScopes,
      // ISO alpha-2 is stored uppercase regardless of client casing.
      countries: upperAll(input.countries),
      cities: input.cities.map((c) => ({
        country: c.country.toUpperCase(),
        city: c.city,
      })) as unknown as Prisma.InputJsonValue,
      homeCountry: input.homeCountry ? input.homeCountry.toUpperCase() : null,
      citizenships: upperAll(input.citizenships),
      workAuthorizations: upperAll(input.workAuthorizations),
      sponsorshipCountries: upperAll(input.sponsorshipCountries),
      relocationWilling: input.relocationWilling,
      relocationCountries: upperAll(input.relocationCountries),
      timezoneOverlapHours: input.timezoneOverlapHours ?? null,
      language: input.language,
    };
    await this.prisma.userJobPreferences.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return this.get(userId);
  }
}
