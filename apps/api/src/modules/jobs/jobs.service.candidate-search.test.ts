import { describe, expect, it, vi } from 'vitest';
import type { JobSourceAdapter, RawJob } from '@careeros/job-pipeline';
import { JobsService } from './jobs.service';

function raw(): RawJob {
  const now = Date.now();
  return {
    sourceId: 'firecrawl:https://jobs.lever.co/acme/1',
    sourceName: 'firecrawl',
    canonicalUrl: 'https://jobs.lever.co/acme/1',
    title: 'Senior Backend Engineer',
    company: 'Acme',
    location: null,
    remote: true,
    description:
      'A detailed job description that comfortably clears the verify thin-description threshold.',
    sourcePostedAt: new Date(now - 86_400_000),
    fetchedAt: new Date(now),
    payload: {},
  };
}

function makePrisma(opts: { goal?: unknown; skills?: Array<{ id: string; name: string }> } = {}) {
  return {
    careerGoal: {
      findUnique: vi.fn(async () => opts.goal ?? null),
    },
    candidateSkillState: {
      findMany: vi.fn(async () => [{ skillId: 'ts', proficiency: 90, recencyDays: 1 }]),
    },
    skill: {
      findMany: vi.fn(async () => opts.skills ?? [{ id: 'ts', name: 'TypeScript' }]),
    },
    jobRaw: { createMany: vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length })) },
    normalizedJob: {
      findMany: vi.fn(async () => []),
      createMany: vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length })),
      update: vi.fn(async () => ({})),
    },
    jobRejectLog: {
      createMany: vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length })),
    },
  };
}

function makeService(prisma: unknown, prefsOver: Record<string, unknown> = {}) {
  const prefs = {
    get: vi.fn(async () => ({
      targetRoles: ['Backend Engineer'],
      locations: ['Berlin'],
      remoteOnly: false,
      currency: 'USD',
      seniority: ['senior'],
      mustHaveSkills: ['ts'],
      dealbreakerSkills: ['php'],
      companyBlacklist: [],
      updatedAt: null,
      ...prefsOver,
    })),
  };
  return new JobsService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    prefs as never,
    {} as never,
    { resolve: async () => ({ values: {}, secrets: {} }) } as never,
  );
}

describe('JobsService.syncCandidateSearch (F7)', () => {
  it('fetches through the injected adapter and ingests survivors', async () => {
    const prisma = makePrisma();
    const svc = makeService(prisma);
    const fetch = vi.fn(async () => [raw()]);
    const adapter: JobSourceAdapter = {
      id: 'firecrawl-search',
      name: 'Firecrawl',
      tier: 3,
      licenseHint: 'test',
      attribution: 'test',
      fetch,
    };

    const stats = await svc.syncCandidateSearch('u1', adapter);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(stats.adapter).toBe('firecrawl-search');
    expect(stats.fetched).toBe(1);
    expect(stats.rawInserted).toBe(1);
    expect(stats.normalizedInserted).toBe(1);
    expect(stats.rejected).toBe(0);
  });

  it('no-ops without calling the adapter when the candidate has no target role', async () => {
    const prisma = makePrisma({ skills: [] });
    const svc = makeService(prisma, { targetRoles: [] });
    const fetch = vi.fn(async () => [raw()]);
    const adapter: JobSourceAdapter = {
      id: 'firecrawl-search',
      name: 'Firecrawl',
      tier: 3,
      licenseHint: 'test',
      attribution: 'test',
      fetch,
    };

    const stats = await svc.syncCandidateSearch('u1', adapter);

    expect(fetch).not.toHaveBeenCalled();
    expect(stats.fetched).toBe(0);
    expect(stats.normalizedInserted).toBe(0);
  });
});
