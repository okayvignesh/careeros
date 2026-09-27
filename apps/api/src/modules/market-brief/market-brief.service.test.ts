import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import type { MarketBriefContent } from '@careeros/shared';
import { MarketBriefService } from './market-brief.service';

// -----------------------------------------------------------------------------
// Test doubles
// -----------------------------------------------------------------------------
// Kept as inline fakes rather than a framework mock. The service touches a
// narrow surface (prisma.normalizedJob.findMany, prisma.marketBrief.create/
// findFirst, prefs.get, usage.runWithUserLimit) so a fake > testcontainers.
// tryLoadProvider is private and pulls in secrets/sensitivity/provider config;
// tests override it via subclass to inject a scripted chatStructured stub.

type Job = {
  id: string;
  title: string;
  company: string;
  canonicalUrl: string;
  remote: boolean;
  skillIds: string[];
  sourcePostedAt: Date | null;
  firstSeenAt: Date;
};

function pool(now = new Date('2026-09-27T12:00:00Z')): Job[] {
  // 6 rows: 4 remote, 5 within the 7-day window (one older -> newCount=5).
  // Two blacklist candidates + one dealbreaker-skill row help the filter test
  // reuse this fixture if it needs to.
  const d = (deltaMs: number) => new Date(now.getTime() - deltaMs);
  return [
    {
      id: 'j1',
      title: 'Senior Backend Engineer',
      company: 'Acme',
      canonicalUrl: 'https://acme.example/j1',
      remote: true,
      skillIds: ['typescript', 'postgres'],
      sourcePostedAt: d(1 * 86_400_000),
      firstSeenAt: d(1 * 86_400_000),
    },
    {
      id: 'j2',
      title: 'Staff Platform Engineer',
      company: 'Acme',
      canonicalUrl: 'https://acme.example/j2',
      remote: true,
      skillIds: ['typescript', 'kubernetes'],
      sourcePostedAt: d(2 * 86_400_000),
      firstSeenAt: d(2 * 86_400_000),
    },
    {
      id: 'j3',
      title: 'Data Engineer',
      company: 'Globex',
      canonicalUrl: 'https://globex.example/j3',
      remote: true,
      skillIds: ['python', 'postgres'],
      sourcePostedAt: d(3 * 86_400_000),
      firstSeenAt: d(3 * 86_400_000),
    },
    {
      id: 'j4',
      title: 'Backend Engineer',
      company: 'Initech',
      canonicalUrl: 'https://initech.example/j4',
      remote: true,
      skillIds: ['typescript'],
      sourcePostedAt: d(4 * 86_400_000),
      firstSeenAt: d(4 * 86_400_000),
    },
    {
      id: 'j5',
      title: 'Site Reliability Engineer',
      company: 'Globex',
      canonicalUrl: 'https://globex.example/j5',
      remote: false,
      skillIds: ['kubernetes', 'postgres'],
      sourcePostedAt: null,
      firstSeenAt: d(5 * 86_400_000),
    },
    {
      id: 'j6',
      title: 'Legacy Backend Engineer',
      company: 'Umbrella',
      canonicalUrl: 'https://umbrella.example/j6',
      remote: false,
      skillIds: ['typescript'],
      // Older than 7-day window but inside the 45-day pre-filter cutoff.
      sourcePostedAt: d(20 * 86_400_000),
      firstSeenAt: d(20 * 86_400_000),
    },
  ];
}

const DEFAULT_PREFS = {
  targetRoles: ['Backend Engineer'],
  locations: ['Remote'],
  remoteOnly: false,
  currency: 'USD' as const,
  seniority: [] as string[],
  mustHaveSkills: [] as string[],
  dealbreakerSkills: [] as string[],
  companyBlacklist: [] as string[],
  updatedAt: '2026-09-20T00:00:00.000Z',
};

function fakePrisma(jobs: Job[]) {
  const created: Array<Record<string, unknown>> = [];
  const findFirstReturns: Array<Record<string, unknown> | null> = [];
  return {
    calls: { created, findFirstReturns },
    normalizedJob: {
      findMany: async () => jobs,
    },
    marketBrief: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `brief-${created.length + 1}`,
          generatedAt: new Date('2026-09-27T12:00:00Z'),
          ...data,
        };
        created.push(row);
        return row;
      },
      findFirst: async () => findFirstReturns.shift() ?? null,
    },
  };
}

function fakeUsage() {
  return {
    runWithUserLimit: async <T>(_u: string, fn: () => Promise<T>) => fn(),
    assertCallAllowed: async () => {},
  };
}

function fakePrefs(overrides: Partial<typeof DEFAULT_PREFS> = {}) {
  return {
    get: async () => ({ ...DEFAULT_PREFS, ...overrides }),
  };
}

// Subclass to bypass the encrypted-secret / sensitivity-gate / DeepSeek plumb
// and inject a scripted chatStructured result directly.
// ponytail: private in the base is compile-time only; runtime override is legal
// and keeps the test off the DeepSeek/secrets/sensitivity stack. We reach into
// the instance with a cast rather than a typed subclass override because the
// base declares `private` (TS refuses `override` on private members).
class TestMarketBriefService extends MarketBriefService {
  constructor(
    deps: ConstructorParameters<typeof MarketBriefService>,
    script: MarketBriefContent | null,
  ) {
    super(...deps);
    (this as unknown as { tryLoadProvider: () => Promise<unknown> }).tryLoadProvider =
      async () => {
        if (script === null) return null;
        return { chatStructured: async () => script };
      };
  }
}

function build(opts: {
  jobs?: Job[];
  script?: MarketBriefContent | null;
  prefs?: Partial<typeof DEFAULT_PREFS>;
} = {}) {
  const jobs = opts.jobs ?? pool();
  const prisma = fakePrisma(jobs);
  const usage = fakeUsage();
  const prefs = fakePrefs(opts.prefs);
  const script = opts.script === undefined
    ? { sections: [{ heading: 'Overview', body: 'body', sourceUrls: [] }] }
    : opts.script;
  const svc = new TestMarketBriefService(
    [prisma as never, usage as never, {} as never, {} as never, prefs as never],
    script,
  );
  return { svc, prisma, usage, prefs };
}

// -----------------------------------------------------------------------------
// computeStats: deterministic contract from a fixed pool
// -----------------------------------------------------------------------------

describe('MarketBriefService.generate stats contract', () => {
  it('computes totalCount, newCount, remoteShare, topSkills, topCompanies from a fixed pool', async () => {
    const { svc, prisma } = build();
    await svc.generate('u1');
    const row = prisma.calls.created[0];
    const stats = row.statsJson as {
      windowDays: number;
      totalCount: number;
      newCount: number;
      remoteShare: number;
      topSkills: Array<{ skillId: string; count: number }>;
      topCompanies: Array<{ company: string; count: number }>;
    };
    expect(stats.windowDays).toBe(7);
    expect(stats.totalCount).toBe(6);
    // Five of six are within the 7d window (j6 is 20d old).
    expect(stats.newCount).toBe(5);
    // Four of six are remote.
    expect(stats.remoteShare).toBeCloseTo(4 / 6, 5);
    // typescript appears in j1, j2, j4, j6 -> 4. postgres in j1, j3, j5 -> 3.
    // kubernetes in j2, j5 -> 2. python in j3 -> 1.
    const skillMap = Object.fromEntries(stats.topSkills.map((s) => [s.skillId, s.count]));
    expect(skillMap).toEqual({ typescript: 4, postgres: 3, kubernetes: 2, python: 1 });
    // topSkills is sorted desc by count.
    expect(stats.topSkills[0]).toEqual({ skillId: 'typescript', count: 4 });
    expect(stats.topSkills[1].count).toBeGreaterThanOrEqual(stats.topSkills[2].count);
    // Companies: Acme x2, Globex x2, Initech x1, Umbrella x1.
    const compMap = Object.fromEntries(stats.topCompanies.map((c) => [c.company, c.count]));
    expect(compMap).toEqual({ Acme: 2, Globex: 2, Initech: 1, Umbrella: 1 });
  });

  it('mutation smoke: removing rows from the pool changes the recorded stats', async () => {
    // Baseline
    const a = build();
    await a.svc.generate('u1');
    const totalA = (a.prisma.calls.created[0].statsJson as { totalCount: number }).totalCount;
    // Same shape minus two rows.
    const b = build({ jobs: pool().slice(0, 4) });
    await b.svc.generate('u1');
    const totalB = (b.prisma.calls.created[0].statsJson as { totalCount: number }).totalCount;
    expect(totalA).toBe(6);
    expect(totalB).toBe(4);
    expect(totalA).not.toBe(totalB);
  });

  it('filters by prefs: dealbreaker skill drops matching rows before stats', async () => {
    const { svc, prisma } = build({ prefs: { dealbreakerSkills: ['kubernetes'] } });
    await svc.generate('u1');
    const stats = prisma.calls.created[0].statsJson as {
      totalCount: number;
      topSkills: Array<{ skillId: string; count: number }>;
    };
    // j2 and j5 carry kubernetes -> dropped. 6 - 2 = 4.
    expect(stats.totalCount).toBe(4);
    const skills = new Set(stats.topSkills.map((s) => s.skillId));
    expect(skills.has('kubernetes')).toBe(false);
  });

  it('filters by prefs: mustHave keeps only rows carrying every required skill', async () => {
    const { svc, prisma } = build({ prefs: { mustHaveSkills: ['postgres'] } });
    await svc.generate('u1');
    const stats = prisma.calls.created[0].statsJson as { totalCount: number };
    // j1, j3, j5 carry postgres.
    expect(stats.totalCount).toBe(3);
  });

  it('filters by prefs: company blacklist is case-insensitive', async () => {
    const { svc, prisma } = build({ prefs: { companyBlacklist: ['acme'] } });
    await svc.generate('u1');
    const stats = prisma.calls.created[0].statsJson as {
      totalCount: number;
      topCompanies: Array<{ company: string; count: number }>;
    };
    expect(stats.totalCount).toBe(4);
    expect(stats.topCompanies.find((c) => c.company === 'Acme')).toBeUndefined();
  });

  it('mutation smoke on remoteShare: an all-remote pool reports 1.0', async () => {
    const remotes = pool().map((j) => ({ ...j, remote: true }));
    const { svc, prisma } = build({ jobs: remotes });
    await svc.generate('u1');
    const stats = prisma.calls.created[0].statsJson as { remoteShare: number };
    expect(stats.remoteShare).toBe(1);
  });
});

// -----------------------------------------------------------------------------
// LLM synthesis contract: brief carries stats numbers + persisted content
// -----------------------------------------------------------------------------

describe('MarketBriefService.generate LLM synthesis contract', () => {
  it('persists the LLM output and exposes it via the returned dto', async () => {
    const script: MarketBriefContent = {
      sections: [
        {
          heading: 'This week you have 6 jobs in your pool',
          body: '5 are new since last week; 67% are tagged remote. typescript leads at 4 postings.',
          sourceUrls: ['https://acme.example/j1'],
        },
      ],
    };
    const { svc, prisma } = build({ script });
    const dto = await svc.generate('u1');
    // The section text is what the LLM produced verbatim -> the numbers we
    // asserted on in the stats block are reachable to the user through prose.
    expect(dto.content.sections).toHaveLength(1);
    expect(dto.content.sections[0].heading).toContain('6 jobs');
    expect(dto.content.sections[0].body).toContain('5 are new');
    expect(dto.content.sections[0].body).toContain('67%');
    expect(dto.content.sections[0].body).toContain('typescript');
    // Persisted row's content matches the returned dto (round-tripped through
    // JSON.stringify/parse in toDto).
    const persisted = JSON.parse(prisma.calls.created[0].content as string) as MarketBriefContent;
    expect(persisted).toEqual(dto.content);
    // Stats numbers are on the persisted row directly, not just in prose.
    const stats = prisma.calls.created[0].statsJson as { totalCount: number; newCount: number };
    expect(stats.totalCount).toBe(6);
    expect(stats.newCount).toBe(5);
  });

  it('throws 400 when the pool is empty (LLM never called)', async () => {
    let called = false;
    const script: MarketBriefContent = {
      sections: [{ heading: 'x', body: 'y', sourceUrls: [] }],
    };
    const { svc } = build({ jobs: [], script });
    // Wrap chatStructured to detect an unwanted call.
    const original = (svc as unknown as { tryLoadProvider: () => Promise<unknown> }).tryLoadProvider;
    (svc as unknown as { tryLoadProvider: () => Promise<unknown> }).tryLoadProvider = async () => {
      const p = await original.call(svc);
      if (!p) return null;
      return {
        chatStructured: async () => {
          called = true;
          return (p as { chatStructured: () => Promise<unknown> }).chatStructured();
        },
      };
    };
    await expect(svc.generate('u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(called).toBe(false);
  });

  it('throws 400 when no provider is available', async () => {
    const { svc } = build({ script: null });
    await expect(svc.generate('u1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

// -----------------------------------------------------------------------------
// URL post-filter: drop off-source URLs; keep on-source URLs
// -----------------------------------------------------------------------------

describe('MarketBriefService.generate URL post-filter', () => {
  it('strips URLs the LLM cites that are not in the sourced jobs pool', async () => {
    const script: MarketBriefContent = {
      sections: [
        {
          heading: 'Trend',
          body: 'Backend hiring is up',
          sourceUrls: [
            'https://acme.example/j1', // in pool - kept
            'https://random-blog.com/xyz', // off-source - dropped
            'https://globex.example/j3', // in pool - kept
            'https://hallucinated.example/nope', // off-source - dropped
          ],
        },
        {
          heading: 'Section 2',
          body: 'body',
          sourceUrls: ['https://another-off-source.example/abc'],
        },
      ],
    };
    const { svc, prisma } = build({ script });
    const dto = await svc.generate('u1');

    expect(dto.content.sections[0].sourceUrls).toEqual([
      'https://acme.example/j1',
      'https://globex.example/j3',
    ]);
    // Section 2's only URL was off-source -> empty array, not dropped section.
    expect(dto.content.sections[1].sourceUrls).toEqual([]);
    // Persisted row is filtered too (not just the returned dto).
    const persisted = JSON.parse(prisma.calls.created[0].content as string) as MarketBriefContent;
    expect(persisted.sections[0].sourceUrls).toEqual([
      'https://acme.example/j1',
      'https://globex.example/j3',
    ]);
  });

  it('mutation smoke: URLs from every pool row are kept when cited', async () => {
    const script: MarketBriefContent = {
      sections: [
        {
          heading: 'All',
          body: 'x',
          sourceUrls: pool().map((j) => j.canonicalUrl),
        },
      ],
    };
    const { svc } = build({ script });
    const dto = await svc.generate('u1');
    expect(dto.content.sections[0].sourceUrls.sort()).toEqual(pool().map((j) => j.canonicalUrl).sort());
  });

  it('mutation smoke: an all-off-source citation list is stripped to empty', async () => {
    const script: MarketBriefContent = {
      sections: [
        {
          heading: 'Hallucinated',
          body: 'x',
          sourceUrls: [
            'https://a.example/x',
            'https://b.example/y',
            'https://c.example/z',
          ],
        },
      ],
    };
    const { svc } = build({ script });
    const dto = await svc.generate('u1');
    expect(dto.content.sections[0].sourceUrls).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// Persistence contract
// -----------------------------------------------------------------------------

describe('MarketBriefService.generate persistence', () => {
  it('writes a MarketBrief row per generate call with generatedAt + windowStart/windowEnd + sources', async () => {
    const { svc, prisma } = build();
    const dto = await svc.generate('u1');

    expect(prisma.calls.created).toHaveLength(1);
    const row = prisma.calls.created[0];
    expect(row.userId).toBe('u1');
    // generatedAt comes from the DB default in the real schema; the fake mirrors
    // that by attaching one after `data` is passed in. The dto exposes it.
    expect(dto.generatedAt).toBe(new Date('2026-09-27T12:00:00Z').toISOString());
    expect(row.windowStart).toBeInstanceOf(Date);
    expect(row.windowEnd).toBeInstanceOf(Date);
    // windowEnd - windowStart == 7d (WINDOW_DAYS).
    const spanMs = (row.windowEnd as Date).getTime() - (row.windowStart as Date).getTime();
    expect(spanMs).toBe(7 * 86_400_000);
    // Sources are drawn from the sample slice (up to JOB_SAMPLE_LIMIT = 25),
    // and every pool url is retained here since |pool| < 25.
    const sources = row.sourcesJson as Array<{ kind: string; ref: string; url: string }>;
    expect(sources).toHaveLength(pool().length);
    for (const s of sources) {
      expect(s.kind).toBe('job');
      expect(s.ref).toBe(s.url);
    }
    // Dto sources mirror persisted sources.
    expect(dto.sources).toEqual(sources);
  });

  it('mutation smoke: changing userId changes the row that gets written', async () => {
    const { svc, prisma } = build();
    await svc.generate('user-alpha');
    await svc.generate('user-beta');
    expect(prisma.calls.created.map((r) => r.userId)).toEqual(['user-alpha', 'user-beta']);
  });

  it('reflects prefs in the persisted sources (mustHave filters the pool -> smaller sources list)', async () => {
    // Prefs deterministically shrink the pool. If the service somehow bypassed
    // prefs when building sources, this test would fail with the full 6-source
    // list instead of the postgres subset.
    const { svc, prisma } = build({ prefs: { mustHaveSkills: ['postgres'] } });
    await svc.generate('u1');
    const sources = prisma.calls.created[0].sourcesJson as Array<{ url: string }>;
    // j1, j3, j5 have postgres.
    expect(sources.map((s) => s.url).sort()).toEqual([
      'https://acme.example/j1',
      'https://globex.example/j3',
      'https://globex.example/j5',
    ]);
  });
});

// -----------------------------------------------------------------------------
// getLatest
// -----------------------------------------------------------------------------

describe('MarketBriefService.getLatest', () => {
  it('returns null when no brief exists yet', async () => {
    const { svc } = build();
    const dto = await svc.getLatest('u1');
    expect(dto).toBeNull();
  });

  it('round-trips a persisted brief back to a dto', async () => {
    const jobs = pool();
    const prisma = fakePrisma(jobs);
    const stored = {
      id: 'brief-xyz',
      generatedAt: new Date('2026-09-20T00:00:00Z'),
      windowStart: new Date('2026-09-13T00:00:00Z'),
      windowEnd: new Date('2026-09-20T00:00:00Z'),
      statsJson: { totalCount: 3, newCount: 2, remoteShare: 0.5, topSkills: [], topCompanies: [], windowDays: 7 },
      content: JSON.stringify({ sections: [{ heading: 'H', body: 'B', sourceUrls: [] }] }),
      sourcesJson: [{ kind: 'job', ref: 'https://x/y', url: 'https://x/y' }],
    };
    prisma.calls.findFirstReturns.push(stored);
    const svc = new TestMarketBriefService(
      [prisma as never, fakeUsage() as never, {} as never, {} as never, fakePrefs() as never],
      null,
    );
    const dto = await svc.getLatest('u1');
    expect(dto).not.toBeNull();
    expect(dto!.id).toBe('brief-xyz');
    expect(dto!.content.sections[0].heading).toBe('H');
    expect(dto!.stats.totalCount).toBe(3);
    expect(dto!.sources).toHaveLength(1);
  });
});
