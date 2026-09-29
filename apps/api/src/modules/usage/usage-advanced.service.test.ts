import { describe, expect, it } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service';
import { UsageAdvancedService } from './usage-advanced.service';
import type { UsageService } from './usage.service';

/**
 * F.9 unit tests. Fakes prisma with the minimum surface each method
 * touches. All assertions pin the arithmetic (cost projection formula,
 * percentile math, CSV escaping) so a refactor cannot silently drift.
 */

function fakePrisma(seed: {
  calls?: Array<{ timestamp: Date; costUsd: number; latencyMs: number; callKind?: string }>;
  hallucinations?: Array<{
    id: string;
    promptId: string;
    promptVersion: string;
    timestamp: Date;
    suspectFragments: string[];
  }>;
  auditEventCounts?: Record<string, number>;
}): PrismaService {
  return {
    llmCall: {
      findMany: async (args: {
        where: { timestamp?: { gte: Date }; callKind?: string };
        select?: unknown;
        orderBy?: unknown;
      }) => {
        let rows = seed.calls ?? [];
        if (args.where.timestamp?.gte) {
          const gte = args.where.timestamp.gte.getTime();
          rows = rows.filter((r) => r.timestamp.getTime() >= gte);
        }
        if (args.where.callKind) {
          rows = rows.filter((r) => r.callKind === args.where.callKind);
        }
        // Emulate select by returning full rows plus stable fields the
        // export path needs; harmless because the caller reads only what
        // it selected.
        return rows.map((r, i) => ({
          id: `c-${i}`,
          timestamp: r.timestamp,
          provider: 'deepseek',
          model: 'v3',
          callKind: r.callKind ?? 'chat',
          promptTokens: 100,
          completionTokens: 200,
          totalTokens: 300,
          costUsd: r.costUsd,
          latencyMs: r.latencyMs,
          ok: true,
        }));
      },
    },
    llmHallucinationLog: {
      count: async () => seed.hallucinations?.length ?? 0,
      findMany: async () => seed.hallucinations ?? [],
    },
    auditEvent: {
      count: async (args: { where: { action: string } }) =>
        seed.auditEventCounts?.[args.where.action] ?? 0,
    },
  } as unknown as PrismaService;
}

function fakeUsage(monthlyLimit: number | null = null): UsageService {
  return { getMonthlyLimit: async () => monthlyLimit } as unknown as UsageService;
}

describe('UsageAdvancedService.costProjection', () => {
  it('extrapolates linearly to the end of the current month', async () => {
    // 7-day window. Total cost = $70 -> avg $10/day.
    // Assuming a 30-day month, projected = $300.
    const now = new Date();
    const calls = Array.from({ length: 7 }, (_, i) => ({
      timestamp: new Date(now.getTime() - i * 86_400_000 + 3_600_000),
      costUsd: 10,
      latencyMs: 100,
    }));
    const svc = new UsageAdvancedService(fakePrisma({ calls }), fakeUsage(200));
    const p = await svc.costProjection('u-1', '7d');
    expect(p.totalCostUsd).toBe(70);
    expect(p.avgDailyCostUsd).toBe(10);
    // Days-in-month varies (28-31); assert projection is within band.
    expect(p.projectedMonthlyCostUsd).toBeGreaterThanOrEqual(280);
    expect(p.projectedMonthlyCostUsd).toBeLessThanOrEqual(310);
    expect(p.monthlyBudgetUsd).toBe(200);
    expect(p.projectedOverBudget).toBe(true);
    expect(p.budgetUtilizationPct).not.toBeNull();
    expect(p.budgetUtilizationPct!).toBeGreaterThan(100);
  });

  it('returns null budget fields when no budget is set', async () => {
    const svc = new UsageAdvancedService(fakePrisma({ calls: [] }), fakeUsage(null));
    const p = await svc.costProjection('u-1', '7d');
    expect(p.monthlyBudgetUsd).toBeNull();
    expect(p.budgetUtilizationPct).toBeNull();
    expect(p.projectedOverBudget).toBeNull();
  });
});

describe('UsageAdvancedService.latencyHistogram', () => {
  it('bucketizes latencies and computes p50/p95/p99', async () => {
    const now = new Date();
    // Latencies 10, 20, ..., 100 ms (10 samples).
    const calls = Array.from({ length: 10 }, (_, i) => ({
      timestamp: new Date(now.getTime() - i * 3_600_000),
      costUsd: 0,
      latencyMs: (i + 1) * 10,
    }));
    const svc = new UsageAdvancedService(fakePrisma({ calls }), fakeUsage());
    const h = await svc.latencyHistogram('u-1', '7d');
    expect(h.sampleSize).toBe(10);
    expect(h.minMs).toBe(10);
    expect(h.maxMs).toBe(100);
    // 10 buckets from 10 to 100 -> bucketSize = ceil(91/10) = 10 wide.
    expect(h.buckets).toHaveLength(10);
    // Each bucket picks up exactly one sample (10/20/...).
    const total = h.buckets.reduce((acc, b) => acc + b.count, 0);
    expect(total).toBe(10);
    expect(h.p50).toBe(60);
    expect(h.p95).toBe(100);
    expect(h.p99).toBe(100);
  });

  it('returns empty histogram + zero percentiles when no samples', async () => {
    const svc = new UsageAdvancedService(fakePrisma({ calls: [] }), fakeUsage());
    const h = await svc.latencyHistogram('u-1', '7d');
    expect(h.sampleSize).toBe(0);
    expect(h.buckets).toEqual([]);
    expect(h.p50).toBe(0);
  });

  it('filters by promptId (currently mapped to callKind)', async () => {
    const now = new Date();
    const calls = [
      { timestamp: now, costUsd: 0, latencyMs: 50, callKind: 'chat' },
      { timestamp: now, costUsd: 0, latencyMs: 200, callKind: 'chatStructured' },
    ];
    const svc = new UsageAdvancedService(fakePrisma({ calls }), fakeUsage());
    const h = await svc.latencyHistogram('u-1', '7d', 'chatStructured');
    expect(h.sampleSize).toBe(1);
    expect(h.p50).toBe(200);
  });
});

describe('UsageAdvancedService.securityStats', () => {
  it('sums hallucinations, injection, and sensitivity blocks', async () => {
    const svc = new UsageAdvancedService(
      fakePrisma({
        hallucinations: [
          {
            id: 'h1',
            promptId: 'p1',
            promptVersion: '1.0.0',
            timestamp: new Date(),
            suspectFragments: ['a', 'b'],
          },
        ],
        auditEventCounts: {
          'security.audit.injection_blocked': 3,
          'security.audit.injection_scanned': 100,
          'security.audit.sensitivity_blocked': 1,
        },
      }),
      fakeUsage(),
    );
    const s = await svc.securityStats('u-1', '30d');
    expect(s.hallucinationSuspectCount).toBe(1);
    expect(s.injectionBlockedCount).toBe(3);
    expect(s.injectionScannedCount).toBe(100);
    expect(s.sensitivityBlockedCount).toBe(1);
    expect(s.recentHallucinations).toHaveLength(1);
    expect(s.recentHallucinations[0]!.suspectFragmentCount).toBe(2);
  });
});

describe('UsageAdvancedService.detectAnomaly', () => {
  it('flags critical when today is >=3x rolling median', async () => {
    // 7 prior days at $1 each; today at $10 -> ratio 10.
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setUTCHours(0, 0, 0, 0);
    const calls: Array<{ timestamp: Date; costUsd: number; latencyMs: number }> = [];
    for (let d = 1; d <= 7; d++) {
      calls.push({
        timestamp: new Date(startOfToday.getTime() - d * 86_400_000 + 3_600_000),
        costUsd: 1,
        latencyMs: 100,
      });
    }
    calls.push({
      timestamp: new Date(startOfToday.getTime() + 3_600_000),
      costUsd: 10,
      latencyMs: 100,
    });
    const svc = new UsageAdvancedService(fakePrisma({ calls }), fakeUsage());
    const r = await svc.detectAnomaly('u-1');
    expect(r.severity).toBe('critical');
    expect(r.flagged).toBe(true);
    expect(r.ratio).toBe(10);
    expect(r.cause).toMatch(/10\.0x/);
  });

  it('warns when ratio is 2-3x', async () => {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setUTCHours(0, 0, 0, 0);
    const calls = Array.from({ length: 7 }, (_, i) => ({
      timestamp: new Date(startOfToday.getTime() - (i + 1) * 86_400_000 + 3_600_000),
      costUsd: 1,
      latencyMs: 100,
    }));
    calls.push({
      timestamp: new Date(startOfToday.getTime() + 3_600_000),
      costUsd: 2.5,
      latencyMs: 100,
    });
    const svc = new UsageAdvancedService(fakePrisma({ calls }), fakeUsage());
    const r = await svc.detectAnomaly('u-1');
    expect(r.severity).toBe('warn');
    expect(r.flagged).toBe(true);
  });

  it('does not flag when ratio is under 2x', async () => {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setUTCHours(0, 0, 0, 0);
    const calls = Array.from({ length: 8 }, (_, i) => ({
      timestamp: new Date(startOfToday.getTime() - i * 86_400_000 + 3_600_000),
      costUsd: 1,
      latencyMs: 100,
    }));
    const svc = new UsageAdvancedService(fakePrisma({ calls }), fakeUsage());
    const r = await svc.detectAnomaly('u-1');
    expect(r.flagged).toBe(false);
    expect(r.severity).toBe('none');
  });
});

describe('UsageAdvancedService.exportCalls', () => {
  it('csv escapes commas and quotes', async () => {
    const svc = new UsageAdvancedService(
      fakePrisma({
        calls: [
          {
            timestamp: new Date('2026-09-29T10:00:00Z'),
            costUsd: 0.001,
            latencyMs: 100,
            callKind: 'chat,with,commas',
          },
        ],
      }),
      fakeUsage(),
    );
    const out = await svc.exportCalls('u-1', '30d', 'csv');
    expect(out.contentType).toMatch(/csv/);
    expect(out.filename).toMatch(/\.csv$/);
    expect(out.body).toContain('id,timestamp,provider');
    // callKind with commas must be quoted.
    expect(out.body).toContain('"chat,with,commas"');
    // MUTATION-SMOKE: drop the CSV-escape branch and the assertion fails
    // because the row breaks column count.
  });

  it('json returns a valid parseable array', async () => {
    const svc = new UsageAdvancedService(
      fakePrisma({
        calls: [
          { timestamp: new Date('2026-09-29T10:00:00Z'), costUsd: 0.5, latencyMs: 200 },
        ],
      }),
      fakeUsage(),
    );
    const out = await svc.exportCalls('u-1', '30d', 'json');
    const parsed = JSON.parse(out.body) as Array<{ costUsd: number }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.costUsd).toBe(0.5);
    expect(out.filename).toMatch(/\.json$/);
  });
});
