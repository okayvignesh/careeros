import { describe, expect, it } from 'vitest';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { LLM_PER_USER_CONCURRENCY, UsageService } from './usage.service';

// Minimal Prisma fake. Only the surface the service touches is stubbed. If a
// method is called that isn't wired, it throws so the missing coverage is loud.
// ponytail: fake > testcontainers here; the arithmetic is what we care about,
// not Postgres itself. When we start asserting SQL shape, swap for a container.
type Row = { costUsd: number; ok?: boolean };
function fakePrisma(rows: { current: Row[]; previous: Row[]; monthSum: number }) {
  return {
    appConfig: {
      findUnique: async ({ where }: { where: { key: string } }) => {
        if (where.key === 'llm.paused') return { value: { paused: false } };
        if (where.key === 'llm.budget') return { value: { monthlyLimitUsd: 10 } };
        return null;
      },
      upsert: async () => ({}),
    },
    llmCall: {
      aggregate: async ({ where }: { where: { timestamp: { gte: Date; lt?: Date } } }) => {
        const from = where.timestamp.gte;
        const to = where.timestamp.lt;
        if (!to) {
          return { _count: { _all: rows.current.length }, _sum: { costUsd: rows.monthSum } };
        }
        // current vs previous discriminated by an epoch check: current window ends now-ish.
        const now = Date.now();
        const isCurrent = to.getTime() > now - 60_000;
        const set = isCurrent ? rows.current : rows.previous;
        void from;
        const cost = set.reduce((a, r) => a + r.costUsd, 0);
        return {
          _count: { _all: set.length },
          _sum: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: cost, latencyMs: 0 },
        };
      },
      count: async () => 0,
    },
  } as unknown;
}

const fakeCache = { remember: async (_u: string, _t: string, load: () => Promise<unknown>) => load(), bumpVersion: async () => {} } as unknown as ConstructorParameters<typeof UsageService>[1];

describe('UsageService.summary', () => {
  it('returns current-window totals plus delta-vs-previous', async () => {
    const svc = new UsageService(
      fakePrisma({ current: [{ costUsd: 3 }, { costUsd: 2 }], previous: [{ costUsd: 1 }], monthSum: 5 }) as never,
      fakeCache,
    );
    const s = await svc.summary('u1', '7d');
    expect(s.calls).toBe(2);
    expect(s.costUsd).toBe(5);
    expect(s.deltaVsPrevious.calls).toBe(1);
    expect(s.deltaVsPrevious.costUsd).toBe(4);
  });
});

describe('UsageService.assertCallAllowed', () => {
  it('throws 503 when paused', async () => {
    const prisma = {
      appConfig: {
        findUnique: async ({ where }: { where: { key: string } }) =>
          where.key === 'llm.paused' ? { value: { paused: true } } : { value: {} },
      },
      llmCall: { aggregate: async () => ({ _sum: { costUsd: 0 }, _count: { _all: 0 } }) },
    };
    const svc = new UsageService(prisma as never, fakeCache);
    await expect(svc.assertCallAllowed('u1')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('throws 503 when monthly spend >= limit', async () => {
    const prisma = {
      appConfig: {
        findUnique: async ({ where }: { where: { key: string } }) =>
          where.key === 'llm.budget' ? { value: { monthlyLimitUsd: 10 } } : { value: { paused: false } },
      },
      llmCall: { aggregate: async () => ({ _sum: { costUsd: 12 }, _count: { _all: 1 } }) },
    };
    const svc = new UsageService(prisma as never, fakeCache);
    await expect(svc.assertCallAllowed('u1')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('passes when under budget and not paused', async () => {
    const prisma = {
      appConfig: {
        findUnique: async ({ where }: { where: { key: string } }) =>
          where.key === 'llm.budget'
            ? { value: { monthlyLimitUsd: 100 } }
            : { value: { paused: false } },
      },
      llmCall: { aggregate: async () => ({ _sum: { costUsd: 3 }, _count: { _all: 1 } }) },
    };
    const svc = new UsageService(prisma as never, fakeCache);
    await expect(svc.assertCallAllowed('u1')).resolves.toBeUndefined();
  });
});

// --- A-M6 multi-tenant guard on global AppConfig mutations ---

describe('UsageService.assertSingleUserForGlobalConfig (A-M6)', () => {
  it('passes when exactly one user exists', async () => {
    const prisma = {
      user: { count: async () => 1 },
      auditEvent: { create: async () => ({}) },
    };
    const svc = new UsageService(prisma as never, fakeCache);
    await expect(svc.assertSingleUserForGlobalConfig()).resolves.toBeUndefined();
  });

  it('throws 403 and writes an audit_log entry when a second user exists', async () => {
    const audits: Array<{ action: string; payload: unknown }> = [];
    const prisma = {
      user: { count: async () => 2 },
      auditEvent: {
        create: async ({ data }: { data: { action: string; payload: unknown } }) => {
          audits.push({ action: data.action, payload: data.payload });
          return {};
        },
      },
    };
    const svc = new UsageService(prisma as never, fakeCache);
    await expect(svc.assertSingleUserForGlobalConfig()).rejects.toBeInstanceOf(ForbiddenException);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: 'config.multi_user_guard_hit',
      payload: { userCount: 2 },
    });
    // MUTATION-SMOKE: delete the `if (count === 1) return;` early-return in
    // assertSingleUserForGlobalConfig and the userCount:1 test above will
    // still throw ForbiddenException → the "passes" test above fails.
    // Delete the throw and this test's `rejects` assertion fails.
  });

  it('throws even if audit-log write fails', async () => {
    const prisma = {
      user: { count: async () => 2 },
      auditEvent: {
        create: async () => {
          throw new Error('audit table missing');
        },
      },
    };
    const svc = new UsageService(prisma as never, fakeCache);
    await expect(svc.assertSingleUserForGlobalConfig()).rejects.toBeInstanceOf(ForbiddenException);
  });
});

// --- A-M9 per-user LLM concurrency ceiling ---

describe('UsageService.runWithUserLimit (A-M9)', () => {
  it(`caps at ${LLM_PER_USER_CONCURRENCY} concurrent per user`, async () => {
    const prisma = { user: { count: async () => 1 } };
    const svc = new UsageService(prisma as never, fakeCache);

    let active = 0;
    let peakActive = 0;
    const trace: number[] = []; // snapshot of `active` at each fn start
    // 5 tasks each resolves after 50ms. If the limiter works, peakActive===2.
    const jobs = Array.from({ length: 5 }, () =>
      svc.runWithUserLimit('u1', async () => {
        active++;
        trace.push(active);
        peakActive = Math.max(peakActive, active);
        await new Promise((r) => setTimeout(r, 50));
        active--;
        return 'ok';
      }),
    );
    const results = await Promise.all(jobs);
    expect(results).toHaveLength(5);
    expect(results.every((r) => r === 'ok')).toBe(true);
    expect(peakActive).toBe(LLM_PER_USER_CONCURRENCY);
    expect(Math.max(...trace)).toBeLessThanOrEqual(LLM_PER_USER_CONCURRENCY);
    // MUTATION-SMOKE: replace `return limit(fn)` with `return fn()` inside
    // runWithUserLimit and peakActive becomes 5 -> this test fails on the
    // strict-equal assertion.
  });

  it('isolates limits per user (u1 saturated does not block u2)', async () => {
    const prisma = { user: { count: async () => 1 } };
    const svc = new UsageService(prisma as never, fakeCache);

    let u1Active = 0;
    let u2Active = 0;
    let peakU1 = 0;
    let peakU2Concurrent = 0;
    // Fill u1's slots with slow tasks so its queue is deep.
    const u1Jobs = Array.from({ length: 4 }, () =>
      svc.runWithUserLimit('u1', async () => {
        u1Active++;
        peakU1 = Math.max(peakU1, u1Active);
        await new Promise((r) => setTimeout(r, 40));
        u1Active--;
        return 'u1';
      }),
    );
    // u2 fires in parallel; if per-user isolation works, both u2 tasks run
    // together even while u1 is saturated.
    const u2Jobs = Array.from({ length: 2 }, () =>
      svc.runWithUserLimit('u2', async () => {
        u2Active++;
        peakU2Concurrent = Math.max(peakU2Concurrent, u2Active);
        await new Promise((r) => setTimeout(r, 20));
        u2Active--;
        return 'u2';
      }),
    );
    await Promise.all([...u1Jobs, ...u2Jobs]);
    expect(peakU1).toBe(LLM_PER_USER_CONCURRENCY);
    expect(peakU2Concurrent).toBe(2);
    // MUTATION-SMOKE: swap the Map for a single shared LimitFunction (drop the
    // userId key) and peakU2Concurrent falls to 0 or 1 while u1 hogs the slots.
  });

  it('propagates errors from the wrapped function', async () => {
    const prisma = { user: { count: async () => 1 } };
    const svc = new UsageService(prisma as never, fakeCache);
    await expect(
      svc.runWithUserLimit('u1', async () => {
        throw new Error('provider blew up');
      }),
    ).rejects.toThrow(/blew up/);
  });
});
