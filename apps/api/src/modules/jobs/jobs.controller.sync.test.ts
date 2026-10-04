import { describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import type { JobSourceAdapter, MarketSyncRequest } from '@careeros/job-pipeline';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

// P1 job-targeting §6: `POST admin/jobs/sync/:adapter` must derive the market
// plan from the caller's JobPreferences and issue the per-market request set —
// not the legacy plan-less single global fetch. This drives the real controller
// + real JobsService (only Prisma/prefs are doubled) so a regression to
// `this.jobs.sync(adapterId)` (no plan) fails here.

const req = {} as Request;

function makePrisma() {
  return {
    candidateSkillState: {
      findMany: vi.fn(async () => [{ skillId: 'ts', proficiency: 90, recencyDays: 1 }]),
    },
    skill: { findMany: vi.fn(async () => [{ id: 'ts', name: 'TypeScript' }]) },
    jobRaw: { createMany: vi.fn(async () => ({ count: 0 })) },
    normalizedJob: {
      findMany: vi.fn(async () => []),
      createMany: vi.fn(async () => ({ count: 0 })),
      update: vi.fn(async () => ({})),
    },
    jobRejectLog: { createMany: vi.fn(async () => ({ count: 0 })) },
  };
}

describe('JobsController.sync — per-market request set', () => {
  it('builds the plan from JobPreferences and issues one request per market', async () => {
    const prisma = makePrisma();
    const prefs = {
      get: vi.fn(async () => ({
        targetRoles: ['Backend Engineer'],
        locations: [],
        remoteOnly: false,
        seniority: ['senior'],
        mustHaveSkills: [] as string[],
        dealbreakerSkills: [] as string[],
        companyBlacklist: [] as string[],
        countries: ['DE', 'US'],
        cities: [] as Array<{ country: string; city: string }>,
        currency: 'USD',
      })),
    };
    const svc = new JobsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      prefs as never,
      {} as never,
    );

    // Legacy registry adapter: a plan-less sync would call THIS once globally.
    const legacyFetch = vi.fn(async () => []);
    (svc as unknown as { adapters: Record<string, JobSourceAdapter> }).adapters = {
      adzuna: {
        id: 'adzuna',
        name: 'Adzuna',
        tier: 2,
        licenseHint: 'test',
        attribution: 'test',
        fetch: legacyFetch,
      },
    };

    // Capture the market requests and the per-market fetches without network.
    const requests: MarketSyncRequest[] = [];
    const fetchedCountries: Array<string | undefined> = [];
    (
      svc as unknown as {
        buildMarketAdapter: (a: string, r: MarketSyncRequest) => JobSourceAdapter;
      }
    ).buildMarketAdapter = (adapterId, request) => {
      requests.push(request);
      return {
        id: adapterId,
        name: 'Adzuna',
        tier: 2,
        licenseHint: 'test',
        attribution: 'test',
        fetch: async () => {
          fetchedCountries.push(request.country);
          return [];
        },
      };
    };

    const session = { requireUserId: vi.fn(() => 'user-1') };
    const controller = new JobsController(svc, session as never);

    await controller.sync('adzuna', req);

    expect(session.requireUserId).toHaveBeenCalledWith(req);
    // One request per configured market, lowercased for Adzuna's path.
    expect(requests.map((r) => r.country)).toEqual(['de', 'us']);
    expect(fetchedCountries).toEqual(['de', 'us']);
    // MUTATION SMOKE: revert the controller to `this.jobs.sync(adapterId)` (no
    // plan) → requests is empty, fetchedCountries is empty and legacyFetch runs
    // once, so all three assertions fail.
    expect(legacyFetch).not.toHaveBeenCalled();
  });
});
