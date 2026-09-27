import { describe, expect, it, vi } from 'vitest';
import type { RawJob } from '@careeros/job-pipeline';
import { JobsService } from './jobs.service';

// C-P3.8b: assert JobsService.sync uses a constant number of Prisma calls
// regardless of batch size. Previously the loop did 3 sequential calls per
// raw row (jobRaw.create + normalizedJob.findUnique + create-or-update),
// which grew to 300+ round-trips for a 100-row batch. New batched shape:
//   - one jobRaw.createMany
//   - one normalizedJob.findMany
//   - one normalizedJob.createMany (if there are inserts)
//   - N normalizedJob.update (only for pre-existing rows)
// So for a fresh sync (all inserts) total = 3, independent of batch size.
//
// Mutation smoke: comments name the mutation each assertion catches.

function raw(i: number): RawJob {
  return {
    sourceId: `id-${i}`,
    sourceName: 'remotive',
    canonicalUrl: `https://example.com/jobs/${i}`,
    title: `Role ${i}`,
    company: `Co ${i}`,
    location: null,
    remote: true,
    description: `desc ${i}`,
    sourcePostedAt: new Date('2026-05-01T00:00:00Z'),
    fetchedAt: new Date('2026-05-15T00:00:00Z'),
    payload: { i },
  };
}

/** Prisma double that counts every call so tests can assert query counts. */
function makePrismaMock(opts: { existingUrls?: string[] } = {}) {
  const existing = new Set(opts.existingUrls ?? []);
  const calls: string[] = [];
  return {
    calls,
    prisma: {
      jobRaw: {
        createMany: vi.fn(async ({ data }: { data: unknown[] }) => {
          calls.push('jobRaw.createMany');
          return { count: data.length };
        }),
      },
      normalizedJob: {
        findMany: vi.fn(async ({ where }: { where: { canonicalUrl: { in: string[] } } }) => {
          calls.push('normalizedJob.findMany');
          return where.canonicalUrl.in
            .filter((u) => existing.has(u))
            .map((u) => ({ canonicalUrl: u, sourceIds: ['remotive:seed'] }));
        }),
        createMany: vi.fn(async ({ data }: { data: unknown[] }) => {
          calls.push('normalizedJob.createMany');
          return { count: data.length };
        }),
        update: vi.fn(async () => {
          calls.push('normalizedJob.update');
          return {};
        }),
      },
    },
  };
}

function makeAdapter(raws: RawJob[]) {
  return {
    id: 'remotive',
    name: 'Remotive',
    tier: 2 as const,
    licenseHint: 'test',
    attribution: 'test',
    fetch: async () => raws,
  };
}

function makeService(prismaMock: unknown, adapter: unknown) {
  // Constructor signature: (prisma, usage, usageCache, sensitivity, prefs).
  // sync() only touches prisma, so the rest can be undefined-shaped stubs.
  const svc = new JobsService(
    prismaMock as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  // Replace the adapter registry with a single-adapter under our control.
  (svc as unknown as { adapters: Record<string, unknown> }).adapters = {
    remotive: adapter,
  };
  return svc;
}

describe('JobsService.sync — query count (C-P3.8b N+1 fix)', () => {
  it('100-row fresh batch: constant queries (3), not 100+', async () => {
    const raws = Array.from({ length: 100 }, (_, i) => raw(i));
    const m = makePrismaMock({ existingUrls: [] });
    const svc = makeService(m.prisma, makeAdapter(raws));

    const stats = await svc.sync('remotive');

    expect(stats.fetched).toBe(100);
    expect(stats.rawInserted).toBe(100);
    expect(stats.normalizedInserted).toBe(100);
    expect(stats.normalizedUpdated).toBe(0);

    // The load-bearing assertion: exactly 3 Prisma calls for a 100-row fresh sync.
    expect(m.calls).toEqual([
      'jobRaw.createMany',
      'normalizedJob.findMany',
      'normalizedJob.createMany',
    ]);
    // MUTATION SMOKE: revert the loop to per-row `findUnique + create` and
    // this length jumps to 300; also revert to per-row `jobRaw.create` and it
    // jumps to 400. Either way this exact match fails.
  });

  it('empty batch: no writes fire, no findMany, adapter no-op', async () => {
    const m = makePrismaMock();
    const svc = makeService(m.prisma, makeAdapter([]));
    const stats = await svc.sync('remotive');
    expect(stats.fetched).toBe(0);
    expect(m.calls).toEqual([]);
    // MUTATION SMOKE: drop the early-return `if (raws.length === 0)` → the
    // createMany call still fires with `data: []` (Prisma allows it) → the
    // assertion above fails.
  });

  it('mixed batch (30 existing + 70 new): 3 base calls + 30 updates (all in-map)', async () => {
    const raws = Array.from({ length: 100 }, (_, i) => raw(i));
    const existing = raws.slice(0, 30).map((r) => r.canonicalUrl);
    const m = makePrismaMock({ existingUrls: existing });
    const svc = makeService(m.prisma, makeAdapter(raws));

    const stats = await svc.sync('remotive');

    expect(stats.normalizedInserted).toBe(70);
    expect(stats.normalizedUpdated).toBe(30);

    // Query shape: 1 jobRaw.createMany + 1 findMany + 1 createMany + 30 updates.
    // The critical property: NO per-row `findUnique` (that would double the
    // count and destroy the O(1)-read-per-batch invariant).
    const findManys = m.calls.filter((c) => c === 'normalizedJob.findMany').length;
    const findUniques = m.calls.filter((c) => c === 'normalizedJob.findUnique').length;
    const updates = m.calls.filter((c) => c === 'normalizedJob.update').length;

    expect(findManys).toBe(1);
    expect(findUniques).toBe(0);
    expect(updates).toBe(30);
    expect(m.calls.length).toBe(33);
    // MUTATION SMOKE: revert to per-row findUnique before update → findUniques
    // becomes 100 and this .toBe(0) fails; skip the map lookup and fall back to
    // the old `findUnique` per row → same. Drop the update loop → updates
    // becomes 0 and the .toBe(30) fails.
  });

  it('sourceIds merge uses the pre-fetched map, not a per-row read', async () => {
    const [r0] = [raw(0)];
    const m = makePrismaMock({ existingUrls: [r0.canonicalUrl] });
    const svc = makeService(m.prisma, makeAdapter([r0]));

    await svc.sync('remotive');

    // Extract the update call args to prove sourceIds got merged with the
    // existing value from findMany (['remotive:seed']) + the new tag.
    const updateCall = m.prisma.normalizedJob.update.mock.calls[0]![0] as {
      data: { sourceIds: string[] };
    };
    expect(updateCall.data.sourceIds).toContain('remotive:seed');
    expect(updateCall.data.sourceIds).toContain('remotive:id-0');
    // Dedup invariant: no duplicates.
    expect(new Set(updateCall.data.sourceIds).size).toBe(updateCall.data.sourceIds.length);
    // MUTATION SMOKE: drop the `uniq(...)` wrapper → still passes here (no
    // duplicate injected), but change the merge to `[n.sourceTag]` alone and
    // .toContain('remotive:seed') fails — the existing sources vanish.
  });
});

// C-P3.8c: match-score pagination. JobsController already enforces
// limit<=200 (see jobs.controller.ts) and JobsService.list already batches
// the user's proven-skill fetch and computes match scores via the pure
// `matchScoreForJob` (no per-row DB call). This block pins those two
// invariants: query count per page is CONSTANT regardless of pool size,
// and the user-skills fetch happens exactly once per request (not once
// per job).

function normalizedJobRow(i: number) {
  // Freshness gate rejects rows > 45 days old, so anchor to `now` so the
  // filter passes and the paged output actually contains rows.
  const now = new Date();
  return {
    id: `job-${i}`,
    canonicalUrl: `https://ex.com/j/${i}`,
    title: `T${i}`,
    company: `C${i}`,
    location: null,
    remote: true,
    description: 'd',
    sourcePostedAt: now,
    firstSeenAt: now,
    primarySource: 'remotive',
    state: 'unverified',
    skillIds: [] as string[],
  };
}

function makeListPrismaMock(poolSize: number) {
  const rows = Array.from({ length: poolSize }, (_, i) => normalizedJobRow(i));
  const calls: string[] = [];
  return {
    calls,
    prisma: {
      normalizedJob: {
        findMany: vi.fn(async ({ take }: { take: number }) => {
          calls.push('normalizedJob.findMany');
          return rows.slice(0, take);
        }),
        count: vi.fn(async () => {
          calls.push('normalizedJob.count');
          return rows.length;
        }),
      },
      candidateSkillState: {
        findMany: vi.fn(async () => {
          calls.push('candidateSkillState.findMany');
          return [{ skillId: 'ts' }, { skillId: 'react' }];
        }),
      },
    },
  };
}

function makeListService(prismaMock: unknown, prefsMock: unknown) {
  return new JobsService(
    prismaMock as never,
    {} as never,
    {} as never,
    {} as never,
    prefsMock as never,
  );
}

describe('JobsService.list — pagination query count (C-P3.8c)', () => {
  const prefsStub = {
    get: async () => ({
      remoteOnly: false,
      mustHaveSkills: [] as string[],
      dealbreakerSkills: [] as string[],
      companyBlacklist: [] as string[],
    }),
  };
  const USER_ID = '00000000-0000-0000-0000-000000000001';

  it('1000-job pool: 50 per page fires constant 4 queries (findMany, count, skills, prefs)', async () => {
    const m = makeListPrismaMock(1000);
    const svc = makeListService(m.prisma, prefsStub);

    const out = await svc.list({ userId: USER_ID, limit: 50, offset: 0 });

    expect(out.jobs.length).toBeGreaterThan(0);
    expect(out.jobs.length).toBeLessThanOrEqual(50);
    expect(out.total).toBe(1000);

    // Prisma call inventory: exactly 3 Prisma calls (findMany + count +
    // candidateSkillState.findMany). Prefs is via the stubbed
    // JobPreferencesService, not Prisma-direct.
    expect(m.calls.filter((c) => c === 'normalizedJob.findMany').length).toBe(1);
    expect(m.calls.filter((c) => c === 'normalizedJob.count').length).toBe(1);
    expect(m.calls.filter((c) => c === 'candidateSkillState.findMany').length).toBe(1);
    expect(m.calls.length).toBe(3);
    // MUTATION SMOKE: swap `matchScoreForJob` (pure) for a per-row
    // `this.prisma.<x>.findMany` inside the map → calls.length jumps to
    // 3 + limit and this assertion fails. Move the candidateSkillState
    // fetch INSIDE the filter loop → the count jumps from 1 to page-size.
  });

  it('page 5 (offset=200): same query count as page 1', async () => {
    const m = makeListPrismaMock(1000);
    const svc = makeListService(m.prisma, prefsStub);
    await svc.list({ userId: USER_ID, limit: 50, offset: 200 });
    expect(m.calls.length).toBe(3);
    // MUTATION SMOKE: naive "one findMany per offset step" mutation would
    // scale with offset; this pins it constant.
  });

  it('user-skills fetch happens ONCE per request, not once per job', async () => {
    const m = makeListPrismaMock(500);
    const svc = makeListService(m.prisma, prefsStub);
    await svc.list({ userId: USER_ID, limit: 50, offset: 0 });
    expect(m.prisma.candidateSkillState.findMany).toHaveBeenCalledTimes(1);
  });
});
