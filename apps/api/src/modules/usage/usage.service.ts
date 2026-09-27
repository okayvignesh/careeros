import { ForbiddenException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import pLimit from 'p-limit';
import { PrismaService } from '../../prisma/prisma.service';
import { UsageCache } from './usage.cache';

// p-limit@3 exposes its Limit type as a namespace member, not a top-level export.
type Limit = ReturnType<typeof pLimit>;

// A-M9: per-user concurrency ceiling on LLM work. Two in flight per user; the
// rest queue. Single-user today so this is effectively a global cap of 2, but
// keyed by userId so multi-tenant is a config change, not a rewrite.
//
// ponytail: in-process Map. If we ever go multi-replica, hoist to Redis via
// bullmq/redis-semaphore. Not worth today at N=1.
export const LLM_PER_USER_CONCURRENCY = 2;

export type Window = '7d' | '30d' | '90d' | 'mtd';

export interface Summary {
  window: Window;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  errors: number;
  avgLatencyMs: number;
  deltaVsPrevious: {
    calls: number;
    costUsd: number;
  };
}

export interface BreakdownRow {
  key: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  pctOfTotal: number;
}

export interface TimeseriesPoint {
  bucket: string; // ISO date/hour
  calls: number;
  costUsd: number;
  promptTokens: number;
  completionTokens: number;
}

export interface CallRow {
  id: string;
  timestamp: string;
  provider: string;
  model: string;
  callKind: string;
  promptTokens: number | null;
  completionTokens: number | null;
  costUsd: number | null;
  latencyMs: number;
  ok: boolean;
  error: string | null;
}

export interface BudgetState {
  monthlyLimitUsd: number | null;
  spentUsd: number;
  remainingUsd: number | null;
  resetsAt: string;
  overLimit: boolean;
}

const PAUSE_KEY = 'llm.paused';
const BUDGET_KEY = 'llm.budget';

@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);
  private readonly userLimits = new Map<string, Limit>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: UsageCache,
  ) {}

  // ---------- A-M9 per-user concurrency ----------

  /**
   * Run `fn` under the per-user LLM concurrency ceiling. Every provider call
   * site (`provider.chatStructured` / `provider.chat`) goes through this so a
   * runaway loop can't fire N parallel completions and blow the provider's
   * per-key RPS cap or the local budget.
   */
  async runWithUserLimit<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    const limit = this.limiterFor(userId);
    if (limit.activeCount >= LLM_PER_USER_CONCURRENCY) {
      this.logger.debug(
        `llm-limiter[${userId}] queue depth=${limit.pendingCount} active=${limit.activeCount}`,
      );
    }
    return limit(fn);
  }

  private limiterFor(userId: string): Limit {
    let limit = this.userLimits.get(userId);
    if (!limit) {
      limit = pLimit(LLM_PER_USER_CONCURRENCY);
      this.userLimits.set(userId, limit);
    }
    return limit;
  }

  // ---------- A-M6 multi-tenant guard ----------

  /**
   * A-M6: single-user MVP guard for mutating `/me/*` config endpoints. These
   * write to global `AppConfig` keys (`llm.paused`, `llm.budget`, sensitivity
   * policy) that are NOT yet scoped by userId. If a second user ever exists in
   * the DB, mutating that config from one user's session would silently affect
   * the other → refuse.
   *
   * TODO(multitenant): scope AppConfig by userId; drop this guard.
   */
  async assertSingleUserForGlobalConfig(): Promise<void> {
    const count = await this.prisma.user.count();
    if (count === 1) return;
    // Fire-and-forget audit; the throw is what actually gates the request.
    await this.prisma.auditEvent
      .create({
        data: {
          actor: 'system',
          action: 'config.multi_user_guard_hit',
          resourceType: 'app_config',
          payload: { userCount: count },
        },
      })
      .catch(() => undefined);
    throw new ForbiddenException('Multi-user config mutation not yet supported');
  }

  // ---------- pause + budget ----------

  async isPaused(): Promise<boolean> {
    const row = await this.prisma.appConfig.findUnique({ where: { key: PAUSE_KEY } });
    return Boolean((row?.value as { paused?: boolean } | null)?.paused);
  }

  async setPaused(paused: boolean): Promise<void> {
    await this.prisma.appConfig.upsert({
      where: { key: PAUSE_KEY },
      create: { key: PAUSE_KEY, value: { paused } },
      update: { value: { paused } },
    });
  }

  async getMonthlyLimit(): Promise<number | null> {
    const row = await this.prisma.appConfig.findUnique({ where: { key: BUDGET_KEY } });
    const v = row?.value as { monthlyLimitUsd?: number } | null;
    return typeof v?.monthlyLimitUsd === 'number' ? v.monthlyLimitUsd : null;
  }

  async setMonthlyLimit(monthlyLimitUsd: number | null): Promise<void> {
    if (monthlyLimitUsd !== null && monthlyLimitUsd < 0) {
      throw new Error('Budget must be non-negative');
    }
    await this.prisma.appConfig.upsert({
      where: { key: BUDGET_KEY },
      create: { key: BUDGET_KEY, value: monthlyLimitUsd === null ? {} : { monthlyLimitUsd } },
      update: { value: monthlyLimitUsd === null ? {} : { monthlyLimitUsd } },
    });
  }

  async getBudget(userId: string): Promise<BudgetState> {
    const monthlyLimitUsd = await this.getMonthlyLimit();
    const mtdStart = monthStart(new Date());
    const spentUsd = await this.sumCost(userId, mtdStart);
    const remainingUsd = monthlyLimitUsd === null ? null : Math.max(0, monthlyLimitUsd - spentUsd);
    return {
      monthlyLimitUsd,
      spentUsd,
      remainingUsd,
      resetsAt: nextMonthStart(new Date()).toISOString(),
      overLimit: monthlyLimitUsd !== null && spentUsd >= monthlyLimitUsd,
    };
  }

  /**
   * Throws 503 if LLM calls are paused OR the monthly budget is exhausted.
   * Called before instantiating a provider in the api service layer.
   *
   * ponytail: per-call SUM(costUsd) scan of the month. Fine at personal-use scale;
   * once llm_calls crosses ~100k rows, cache the monthly total in Redis and invalidate
   * on new insert. Also racy under concurrent calls (two calls both squeeze under the
   * limit). Serialising via an advisory lock is not worth it for a single-user OS.
   */
  async assertCallAllowed(userId: string): Promise<void> {
    if (await this.isPaused()) {
      throw new ServiceUnavailableException('LLM calls are paused. Resume from Settings, Usage.');
    }
    const budget = await this.getBudget(userId);
    if (budget.overLimit) {
      throw new ServiceUnavailableException(
        `Monthly LLM budget exhausted ($${budget.spentUsd.toFixed(2)} of $${budget.monthlyLimitUsd?.toFixed(2)}). Raise the limit in Settings, Usage.`,
      );
    }
  }

  // ---------- aggregations ----------

  async summary(userId: string, window: Window): Promise<Summary> {
    return this.cache.remember(userId, `summary:${window}`, async () => {
      const now = new Date();
      const from = windowStart(now, window);
      // Previous window is length-matched to the current one so MTD (partial month)
      // compares against the same elapsed time in the prior month, not the full prior month.
      const elapsedMs = now.getTime() - from.getTime();
      const prevTo = from;
      const prevFrom = new Date(prevTo.getTime() - elapsedMs);

      const [current, previous] = await Promise.all([
        this.aggregateOne(userId, from, now),
        this.aggregateOne(userId, prevFrom, prevTo),
      ]);

      return {
        window,
        ...current,
        deltaVsPrevious: {
          calls: current.calls - previous.calls,
          costUsd: current.costUsd - previous.costUsd,
        },
      };
    });
  }

  async breakdown(
    userId: string,
    by: 'provider' | 'model' | 'callKind',
    window: Window,
  ): Promise<BreakdownRow[]> {
    return this.cache.remember(userId, `breakdown:${by}:${window}`, async () => {
      const from = windowStart(new Date(), window);
      // Prisma groupBy for a keyed sum.
      const rows = await this.prisma.llmCall.groupBy({
        by: [by],
        where: { userId, timestamp: { gte: from } },
        _count: { _all: true },
        _sum: { promptTokens: true, completionTokens: true, costUsd: true },
      });
      const totalCost = rows.reduce((acc, r) => acc + Number(r._sum.costUsd ?? 0), 0);
      return rows
        .map((r) => ({
          key: String((r as Record<string, unknown>)[by] ?? ''),
          calls: r._count._all,
          promptTokens: r._sum.promptTokens ?? 0,
          completionTokens: r._sum.completionTokens ?? 0,
          costUsd: Number(r._sum.costUsd ?? 0),
          pctOfTotal: totalCost > 0 ? (Number(r._sum.costUsd ?? 0) / totalCost) * 100 : 0,
        }))
        .sort((a, b) => b.costUsd - a.costUsd);
    });
  }

  async timeseries(
    userId: string,
    window: Window,
    bucket: 'hour' | 'day' = 'day',
  ): Promise<TimeseriesPoint[]> {
    return this.cache.remember(userId, `ts:${window}:${bucket}`, () => this.computeTimeseries(userId, window, bucket));
  }

  private async computeTimeseries(
    userId: string,
    window: Window,
    bucket: 'hour' | 'day',
  ): Promise<TimeseriesPoint[]> {
    const from = windowStart(new Date(), window);
    // date_trunc via $queryRaw. Prisma can't groupBy on a computed column easily.
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        bucket: Date;
        calls: bigint;
        cost: string | null;
        prompt: bigint | null;
        completion: bigint | null;
      }>
    >(
      `SELECT date_trunc($1, "timestamp") AS bucket,
              COUNT(*)::bigint AS calls,
              COALESCE(SUM("costUsd"), 0) AS cost,
              COALESCE(SUM("promptTokens"), 0)::bigint AS prompt,
              COALESCE(SUM("completionTokens"), 0)::bigint AS completion
       FROM llm_calls
       WHERE "userId" = $2::uuid AND "timestamp" >= $3
       GROUP BY 1
       ORDER BY 1 ASC`,
      bucket,
      userId,
      from,
    );
    return rows.map((r) => ({
      bucket: r.bucket.toISOString(),
      calls: Number(r.calls),
      costUsd: Number(r.cost ?? 0),
      promptTokens: Number(r.prompt ?? 0),
      completionTokens: Number(r.completion ?? 0),
    }));
  }

  async calls(
    userId: string,
    limit: number,
    filter: { errorsOnly?: boolean; provider?: string; model?: string },
  ): Promise<CallRow[]> {
    const rows = await this.prisma.llmCall.findMany({
      where: {
        userId,
        ...(filter.errorsOnly ? { ok: false } : {}),
        ...(filter.provider ? { provider: filter.provider } : {}),
        ...(filter.model ? { model: filter.model } : {}),
      },
      orderBy: { timestamp: 'desc' },
      take: Math.min(Math.max(limit, 1), 500),
    });
    return rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp.toISOString(),
      provider: r.provider,
      model: r.model,
      callKind: r.callKind,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      costUsd: r.costUsd === null ? null : Number(r.costUsd),
      latencyMs: r.latencyMs,
      ok: r.ok,
      error: r.error,
    }));
  }

  // ---------- helpers ----------

  private async aggregateOne(
    userId: string,
    from: Date,
    to: Date,
  ): Promise<Omit<Summary, 'window' | 'deltaVsPrevious'>> {
    const agg = await this.prisma.llmCall.aggregate({
      where: { userId, timestamp: { gte: from, lt: to } },
      _count: { _all: true },
      _sum: { promptTokens: true, completionTokens: true, totalTokens: true, costUsd: true, latencyMs: true },
    });
    const errors = await this.prisma.llmCall.count({
      where: { userId, timestamp: { gte: from, lt: to }, ok: false },
    });
    const calls = agg._count._all;
    const totalLatency = Number(agg._sum.latencyMs ?? 0);
    return {
      calls,
      promptTokens: agg._sum.promptTokens ?? 0,
      completionTokens: agg._sum.completionTokens ?? 0,
      totalTokens: agg._sum.totalTokens ?? 0,
      costUsd: Number(agg._sum.costUsd ?? 0),
      errors,
      avgLatencyMs: calls > 0 ? Math.round(totalLatency / calls) : 0,
    };
  }

  private async sumCost(userId: string, from: Date): Promise<number> {
    const agg = await this.prisma.llmCall.aggregate({
      where: { userId, timestamp: { gte: from } },
      _sum: { costUsd: true },
    });
    return Number(agg._sum.costUsd ?? 0);
  }
}

function windowStart(now: Date, window: Window): Date {
  switch (window) {
    case '7d':
      return new Date(now.getTime() - 7 * 86_400_000);
    case '30d':
      return new Date(now.getTime() - 30 * 86_400_000);
    case '90d':
      return new Date(now.getTime() - 90 * 86_400_000);
    case 'mtd':
      return monthStart(now);
  }
}

function monthStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
}

function nextMonthStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}
