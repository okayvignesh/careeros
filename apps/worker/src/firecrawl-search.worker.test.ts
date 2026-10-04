import { describe, expect, it, vi } from 'vitest';
import type { FirecrawlJobClient } from '@careeros/job-pipeline';
import {
  FirecrawlBudget,
  isFirecrawlKilled,
  readFirecrawlBudgetConfig,
} from './firecrawl-budget';
import { pollCrawlStatus } from './firecrawl-crawl';
import {
  handleFirecrawlSearch,
  loadCandidateSearchPlans,
  readMinIntervalMs,
  runFirecrawlSearchCycle,
  type CandidateGoalRow,
  type FirecrawlSearchRepo,
} from './firecrawl-search.worker';

const LONG = 'A detailed job description that comfortably clears the verify thin-description threshold.';
const DEV = 'https://jobs.lever.co/acme/1';
const ATS = 'https://boards.greenhouse.io/globex/jobs/2';
const BANNED = 'https://www.linkedin.com/jobs/view/9';

function hit(url: string, title: string) {
  return { url, title, description: LONG };
}

function fakeClient(searches: Record<string, unknown[]>) {
  const search = vi.fn(async ({ query }: { query: string }) => ({
    success: true as const,
    data: searches[query] ?? [],
  }));
  const scrape = vi.fn(async () => ({
    success: true as const,
    data: { markdown: LONG, metadata: { title: 'Scraped Role' } },
  }));
  return {
    client: { search, scrape } as unknown as FirecrawlJobClient,
    search,
    scrape,
  };
}

interface FakeRepo extends FirecrawlSearchRepo {
  rawRows: Array<Record<string, unknown>>;
  normalizedRows: Array<Record<string, unknown>>;
  rejectRows: Array<Record<string, unknown>>;
  auditRows: Array<Record<string, unknown>>;
}

function fakeRepo(goals: CandidateGoalRow[]): FakeRepo {
  const rawRows: Array<Record<string, unknown>> = [];
  const normalizedRows: Array<Record<string, unknown>> = [];
  const rejectRows: Array<Record<string, unknown>> = [];
  const auditRows: Array<Record<string, unknown>> = [];
  return {
    rawRows,
    normalizedRows,
    rejectRows,
    auditRows,
    careerGoal: { findMany: async () => goals },
    userJobPreferences: {
      findUnique: async () => ({
        targetRoles: ['Backend Engineer', 'Platform Engineer', 'SRE'],
        locations: ['Berlin'],
        remoteOnly: false,
        seniority: ['senior'],
        mustHaveSkills: ['ts'],
        dealbreakerSkills: ['php'],
        countries: [],
        cities: [],
      }),
    },
    candidateSkillState: {
      findMany: async () => [
        { skillId: 'ts', proficiency: 80, recencyDays: 1 },
        { skillId: 'python', proficiency: 70, recencyDays: 3 },
      ],
    },
    skill: {
      findMany: async () => [
        { id: 'ts', name: 'TypeScript' },
        { id: 'python', name: 'Python' },
        { id: 'php', name: 'PHP' },
      ],
    },
    jobRaw: {
      createMany: async ({ data }) => {
        rawRows.push(...data);
        return { count: data.length };
      },
    },
    normalizedJob: {
      findMany: async () => [],
      createMany: async ({ data }) => {
        normalizedRows.push(...data);
        return { count: data.length };
      },
      update: async () => ({}),
    },
    jobRejectLog: {
      createMany: async ({ data }) => {
        rejectRows.push(...data);
        return { count: data.length };
      },
    },
    auditEvent: {
      create: async ({ data }) => {
        auditRows.push(data);
        return data;
      },
    },
  };
}

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const GOAL = {
  userId: 'u1',
  targetRoles: ['Backend Engineer', 'Platform Engineer', 'SRE'],
  locations: ['Berlin'],
  remoteOnly: true,
  seniority: ['senior'],
};

const TEST_ENV = { FIRECRAWL_MIN_INTERVAL_MS: '0' } as NodeJS.ProcessEnv;

describe('loadCandidateSearchPlans (F7 query builder from profile)', () => {
  it('derives role/location/skill queries from goals + prefs + skills', async () => {
    const repo = fakeRepo([GOAL]);
    const plans = await loadCandidateSearchPlans(repo);
    expect(plans).toHaveLength(1);
    const [q] = plans[0]!.queries;
    expect(q).toContain('senior');
    expect(q).toContain('Backend Engineer');
    expect(q).toContain('in Berlin');
    expect(q).toContain('TypeScript');
    expect(q).toContain('Python');
    expect(q).toContain('-"PHP"');
  });

  it('returns no plan when there is no target role', async () => {
    const repo = fakeRepo([GOAL]);
    repo.userJobPreferences.findUnique = async () => ({
      targetRoles: [],
      locations: [],
      remoteOnly: false,
      seniority: [],
      mustHaveSkills: [],
      dealbreakerSkills: [],
      countries: [],
      cities: [],
    });
    expect(await loadCandidateSearchPlans(repo)).toEqual([]);
  });
});

describe('runFirecrawlSearchCycle (F7 dedupe/feed)', () => {
  it('filters banned platforms, dedupes, and persists normalized hits', async () => {
    const repo = fakeRepo([GOAL]);
    const plans = await loadCandidateSearchPlans(repo);
    const firstQuery = plans[0]!.queries[0]!;
    // Builder yields 3 role queries; first query carries the interesting hits.
    const { client, search } = fakeClient({
      [firstQuery]: [
        hit(DEV, 'Senior Backend Engineer'),
        hit(ATS, 'Platform Engineer'),
        hit(BANNED, 'Banned role'),
        hit(DEV, 'Senior Backend Engineer'),
      ],
    });

    const summary = await runFirecrawlSearchCycle({ repo, client, logger, env: TEST_ENV });

    expect(search).toHaveBeenCalledTimes(3);
    expect(summary.fetched).toBe(2);
    expect(summary.rawInserted).toBe(2);
    expect(summary.normalizedInserted).toBe(2);
    expect(repo.rawRows).toHaveLength(2);
    expect(repo.normalizedRows).toHaveLength(2);
    for (const row of repo.rawRows) expect(String(row.canonicalUrl)).not.toContain('linkedin.com');
    // P1 state promotion: verify-trusted rows land as `verified`.
    for (const row of repo.normalizedRows) {
      expect(row.state).toBe('verified');
      expect(row.geoParsedAt).toBeInstanceOf(Date);
    }
    expect(summary.cost.creditsSpent).toBeGreaterThanOrEqual(2);
    expect(repo.auditRows.length).toBeGreaterThanOrEqual(1);
  });

  it('stops issuing Firecrawl calls once the credit cap is hit', async () => {
    const repo = fakeRepo([GOAL]);
    const { client, search } = fakeClient({});
    const budget = new FirecrawlBudget({
      maxCreditsPerRun: 1,
      maxCreditsPerDay: 100,
      usdPerCredit: 0,
    });

    const summary = await runFirecrawlSearchCycle({ repo, client, logger, env: TEST_ENV, budget });

    expect(search).toHaveBeenCalledTimes(1);
    expect(summary.cost.creditsSpent).toBe(1);
    expect(summary.cost.creditsRemaining).toBe(0);
  });

  it('stops all calls when the kill switch is tripped', async () => {
    const repo = fakeRepo([GOAL]);
    const { client, search } = fakeClient({});
    const summary = await runFirecrawlSearchCycle({
      repo,
      client,
      logger,
      env: { ...TEST_ENV, FIRECRAWL_KILL_SWITCH: 'true' },
    });
    expect(search).not.toHaveBeenCalled();
    expect(summary.killed).toBe(true);
    expect(repo.auditRows.some((a) => a.action === 'job.firecrawl_search.killed')).toBe(true);
  });
});

describe('handleFirecrawlSearch (missing key no-op)', () => {
  it('logs and no-ops cleanly when FIRECRAWL_API_KEY is unset', async () => {
    const repo = fakeRepo([GOAL]);
    const createClient = vi.fn();
    const result = await handleFirecrawlSearch(
      repo as never,
      logger,
      { reason: 'scheduled' },
      { env: {}, createClient },
    );
    expect(result).toEqual({ skipped: true, reason: 'missing-api-key' });
    expect(createClient).not.toHaveBeenCalled();
    expect(repo.auditRows.some((a) => a.action === 'job.firecrawl_search.unconfigured')).toBe(true);
  });
});

describe('FirecrawlBudget + kill switch + pacing', () => {
  it('reads configurable caps from env with conservative defaults', () => {
    expect(readFirecrawlBudgetConfig({})).toEqual({
      maxCreditsPerRun: 25,
      maxCreditsPerDay: 200,
      usdPerCredit: 0,
    });
    expect(
      readFirecrawlBudgetConfig({
        FIRECRAWL_MAX_CREDITS_PER_RUN: '5',
        FIRECRAWL_MAX_CREDITS_PER_DAY: '40',
        FIRECRAWL_USD_PER_CREDIT: '0.002',
      }),
    ).toEqual({ maxCreditsPerRun: 5, maxCreditsPerDay: 40, usdPerCredit: 0.002 });
  });

  it('never spends past the run cap and reports cost', () => {
    const budget = new FirecrawlBudget(
      { maxCreditsPerRun: 2, maxCreditsPerDay: 100, usdPerCredit: 0.5 },
      { spentToday: 1 },
    );
    expect(budget.spend(1)).toBe(true);
    expect(budget.spend(1)).toBe(true);
    expect(budget.spend(1)).toBe(false);
    expect(budget.report()).toMatchObject({ creditsSpent: 2, creditsRemaining: 0, usdEstimate: 1 });
  });

  it('detects the kill switch via env flag or pause file', () => {
    expect(isFirecrawlKilled({ FIRECRAWL_KILL_SWITCH: 'on' }, () => false)).toBe(true);
    expect(isFirecrawlKilled({}, (p) => p.endsWith('firecrawl.paused'))).toBe(true);
    expect(isFirecrawlKilled({}, () => false)).toBe(false);
  });

  it('derives per-host pacing from the shared rate limit', () => {
    expect(readMinIntervalMs({})).toBe(6000); // 10 calls/min → 6000ms
    expect(readMinIntervalMs({ FIRECRAWL_MIN_INTERVAL_MS: '0' })).toBe(0);
  });
});

describe('pollCrawlStatus (bounded poll budget)', () => {
  it('stops after maxPolls while the crawl is still scraping', async () => {
    const getCrawlStatus = vi.fn(async () => ({
      status: 'scraping' as const,
      completed: 1,
      total: 10,
      data: [],
    }));
    const budget = new FirecrawlBudget(
      { maxCreditsPerRun: 50, maxCreditsPerDay: 50, usdPerCredit: 0 },
    );
    const sleep = vi.fn(async () => {});
    const status = await pollCrawlStatus(
      { getCrawlStatus } as never,
      'crawl_1',
      { maxPolls: 3, pollIntervalMs: 1, sleep, budget, shouldStop: () => !budget.allow(1) },
    );
    expect(getCrawlStatus).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(status.status).toBe('scraping');
  });

  it('returns early on a terminal status', async () => {
    const getCrawlStatus = vi.fn(async () => ({
      status: 'completed' as const,
      completed: 10,
      total: 10,
      creditsUsed: 10,
      data: [],
    }));
    const budget = new FirecrawlBudget(
      { maxCreditsPerRun: 50, maxCreditsPerDay: 50, usdPerCredit: 0 },
    );
    const status = await pollCrawlStatus(
      { getCrawlStatus } as never,
      'crawl_2',
      { maxPolls: 5, pollIntervalMs: 1, sleep: async () => {}, budget, shouldStop: () => false },
    );
    expect(getCrawlStatus).toHaveBeenCalledTimes(1);
    expect(status.status).toBe('completed');
  });
});
