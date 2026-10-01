// Weekly market-brief regeneration cron tests. The BullMQ wiring itself
// (Queue/Worker over Redis) is covered by the daily-brief scheduler suite +
// market-snapshot worker suite; here we only pin the fire-body contract:
//   - enumerates every UserJobPreferences row
//   - calls MarketBriefService.generate per user
//   - a single generate failure does not stop the batch
//   - returns a summary with users/generated/errors counts
//
// We instantiate the class WITHOUT calling onModuleInit (that path tries to
// touch BullMQ/Redis). onModuleInit itself is tiny — a static jobId repeat
// add; see daily-brief.scheduler for the shape.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  JOB_MARKET_BRIEF,
  MARKET_BRIEF_CRON,
  MarketBriefScheduler,
} from './market-brief.scheduler';
import type { MarketBriefService } from './market-brief.service';
import type { PrismaService } from '../../prisma/prisma.service';

// Keep BullMQ out of the test — we only exercise runJob().
vi.mock('bullmq', () => ({
  Queue: class {
    async add() {
      return undefined;
    }
    async close() {
      return undefined;
    }
  },
  Worker: class {
    on() {
      return this;
    }
    async close() {
      return undefined;
    }
  },
}));

function makePrisma(userIds: string[]): PrismaService {
  return {
    userJobPreferences: {
      findMany: async () => userIds.map((userId) => ({ userId })),
    },
  } as unknown as PrismaService;
}

describe('MarketBriefScheduler.runJob', () => {
  let originalEnv: string | undefined;
  beforeEach(() => {
    originalEnv = process.env.MARKET_BRIEF_CRON_DISABLE;
    process.env.MARKET_BRIEF_CRON_DISABLE = '1'; // belt-and-braces; onModuleInit won't run
  });
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.MARKET_BRIEF_CRON_DISABLE;
    else process.env.MARKET_BRIEF_CRON_DISABLE = originalEnv;
  });

  it('calls MarketBriefService.generate once per user with saved prefs', async () => {
    const generate = vi.fn().mockResolvedValue({ id: 'brief-x' });
    const prisma = makePrisma(['u1', 'u2', 'u3']);
    const briefs = { generate } as unknown as MarketBriefService;
    const sched = new MarketBriefScheduler(prisma, briefs);
    const summary = await sched.runJob(JOB_MARKET_BRIEF);
    expect(generate).toHaveBeenCalledTimes(3);
    expect(generate.mock.calls.map((c) => c[0])).toEqual(['u1', 'u2', 'u3']);
    expect(summary.users).toBe(3);
    expect(summary.briefsGenerated).toBe(3);
    expect(summary.errors).toBe(0);
    await sched.onModuleDestroy();
  });

  it('one user failing does not stop the batch — error counted, others still generated', async () => {
    const generate = vi
      .fn()
      // first user: ok
      .mockResolvedValueOnce({ id: 'brief-1' })
      // second: throws (simulate "no matching jobs")
      .mockRejectedValueOnce(new Error('No matching jobs in the pool.'))
      // third: ok
      .mockResolvedValueOnce({ id: 'brief-3' });
    const prisma = makePrisma(['u1', 'u2', 'u3']);
    const briefs = { generate } as unknown as MarketBriefService;
    const sched = new MarketBriefScheduler(prisma, briefs);
    const summary = await sched.runJob(JOB_MARKET_BRIEF);
    expect(generate).toHaveBeenCalledTimes(3);
    expect(summary.briefsGenerated).toBe(2);
    expect(summary.errors).toBe(1);
    expect(summary.users).toBe(3);
    await sched.onModuleDestroy();
  });

  it('empty users list: no generate calls, zero counts', async () => {
    const generate = vi.fn();
    const prisma = makePrisma([]);
    const briefs = { generate } as unknown as MarketBriefService;
    const sched = new MarketBriefScheduler(prisma, briefs);
    const summary = await sched.runJob(JOB_MARKET_BRIEF);
    expect(generate).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ users: 0, briefsGenerated: 0, errors: 0 });
    await sched.onModuleDestroy();
  });

  it('unknown job name: logs warn, returns zero summary, no generate calls', async () => {
    const generate = vi.fn();
    const prisma = makePrisma(['u1']);
    const briefs = { generate } as unknown as MarketBriefService;
    const sched = new MarketBriefScheduler(prisma, briefs);
    const summary = await sched.runJob('nope');
    expect(generate).not.toHaveBeenCalled();
    expect(summary.briefsGenerated).toBe(0);
    expect(summary.users).toBe(0);
    await sched.onModuleDestroy();
  });

  it('cron pattern is a standard Monday-weekly expression', () => {
    // "min hour dom month dow" — assert the dow is Monday (1) and non-wildcarded min/hour.
    expect(MARKET_BRIEF_CRON).toBe('0 9 * * 1');
  });
});
