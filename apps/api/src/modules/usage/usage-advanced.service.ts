// F.9 (Wave F / P6): advanced usage + costs analytics.
//
// Extends the P1 basic dashboard (see usage.service.ts) with the
// analytics the phase-6:107-118 spec calls out. Kept in a separate file
// so the P1 hot path stays small; both services read from `llm_calls`
// + `llm_hallucination_log` + `audit_events`.
//
// Skipped for this slice (add when a real caller bites):
//   - Model-comparison view - needs multi-provider active on the same
//     user; single-provider deployments have nothing to compare.
//   - Eval pass-rate chart - fed by the nightly-evals workflow's
//     summary table which does not exist yet.
//   - Alert config webhook UI - requires the F.10 web screens.
//   - Feedback loop (thumbs-down) - needs the artifact-UI wiring.
//   - Per-user retention override UI - default 90d already applies via
//     the cron worker; per-user override lands with a UI.

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UsageService, type Window } from './usage.service';

const WINDOW_DAYS: Record<Window, number> = { '7d': 7, '30d': 30, '90d': 90, mtd: 30 };

const HISTOGRAM_BUCKETS = 10;

export interface CostProjection {
  window: Window;
  windowDays: number;
  totalCostUsd: number;
  avgDailyCostUsd: number;
  projectedMonthlyCostUsd: number;
  monthlyBudgetUsd: number | null;
  budgetUtilizationPct: number | null;
  projectedOverBudget: boolean | null;
}

export interface LatencyHistogram {
  window: Window;
  promptId: string | null;
  minMs: number;
  maxMs: number;
  p50: number;
  p95: number;
  p99: number;
  buckets: Array<{ loMs: number; hiMs: number; count: number }>;
  sampleSize: number;
}

export interface SecurityStats {
  window: Window;
  hallucinationSuspectCount: number;
  injectionBlockedCount: number;
  injectionScannedCount: number;
  sensitivityBlockedCount: number;
  recentHallucinations: Array<{
    id: string;
    promptId: string;
    promptVersion: string;
    timestamp: string;
    suspectFragmentCount: number;
  }>;
}

export interface AnomalyReport {
  window: Window;
  todaysCostUsd: number;
  rollingMedianCostUsd: number;
  ratio: number | null;
  flagged: boolean;
  severity: 'none' | 'warn' | 'critical';
  cause: string | null;
}

/**
 * Column subset used by CSV/JSON export. Skips `error` to avoid leaking
 * upstream error messages into an operator's download (per A-L1 policy).
 */
const EXPORT_COLUMNS = [
  'id',
  'timestamp',
  'provider',
  'model',
  'callKind',
  'promptTokens',
  'completionTokens',
  'totalTokens',
  'costUsd',
  'latencyMs',
  'ok',
] as const;

export type ExportFormat = 'csv' | 'json';

@Injectable()
export class UsageAdvancedService {
  private readonly logger = new Logger(UsageAdvancedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
  ) {}

  async costProjection(userId: string, window: Window): Promise<CostProjection> {
    const days = WINDOW_DAYS[window];
    const from = new Date(Date.now() - days * 86_400_000);
    const rows = await this.prisma.llmCall.findMany({
      where: { userId, timestamp: { gte: from } },
      select: { costUsd: true },
    });
    const total = rows.reduce((acc, r) => acc + Number(r.costUsd ?? 0), 0);
    const avgDaily = days > 0 ? total / days : 0;
    // "Rest of this month" projection: today's remaining days + upcoming.
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const projectedMonthly = avgDaily * daysInMonth;
    const budget = await this.usage.getMonthlyLimit();
    return {
      window,
      windowDays: days,
      totalCostUsd: round(total),
      avgDailyCostUsd: round(avgDaily),
      projectedMonthlyCostUsd: round(projectedMonthly),
      monthlyBudgetUsd: budget,
      budgetUtilizationPct: budget && budget > 0 ? round((projectedMonthly / budget) * 100) : null,
      projectedOverBudget: budget !== null ? projectedMonthly > budget : null,
    };
  }

  async latencyHistogram(
    userId: string,
    window: Window,
    promptId?: string,
  ): Promise<LatencyHistogram> {
    const days = WINDOW_DAYS[window];
    const from = new Date(Date.now() - days * 86_400_000);
    // promptId is not on LlmCall directly; the current LlmCall shape
    // does not store the promptId (only provider/model/callKind). We
    // treat `promptId` as a filter on callKind for now, matching the
    // basic dashboard convention. When llm_calls gets a promptId column
    // the filter refines automatically.
    const where: { userId: string; timestamp: { gte: Date }; callKind?: string } = {
      userId,
      timestamp: { gte: from },
    };
    if (promptId) where.callKind = promptId;
    const rows = await this.prisma.llmCall.findMany({
      where,
      select: { latencyMs: true },
    });
    const latencies = rows.map((r) => r.latencyMs).sort((a, b) => a - b);
    if (latencies.length === 0) {
      return {
        window,
        promptId: promptId ?? null,
        minMs: 0,
        maxMs: 0,
        p50: 0,
        p95: 0,
        p99: 0,
        buckets: [],
        sampleSize: 0,
      };
    }
    const min = latencies[0]!;
    const max = latencies[latencies.length - 1]!;
    const bucketSize = Math.max(1, Math.ceil((max - min + 1) / HISTOGRAM_BUCKETS));
    const buckets = Array.from({ length: HISTOGRAM_BUCKETS }, (_, i) => ({
      loMs: min + i * bucketSize,
      hiMs: min + (i + 1) * bucketSize - 1,
      count: 0,
    }));
    for (const ms of latencies) {
      const idx = Math.min(HISTOGRAM_BUCKETS - 1, Math.floor((ms - min) / bucketSize));
      buckets[idx]!.count += 1;
    }
    return {
      window,
      promptId: promptId ?? null,
      minMs: min,
      maxMs: max,
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      p99: percentile(latencies, 0.99),
      buckets,
      sampleSize: latencies.length,
    };
  }

  async securityStats(userId: string, window: Window): Promise<SecurityStats> {
    const days = WINDOW_DAYS[window];
    const from = new Date(Date.now() - days * 86_400_000);
    const [hallucinations, injectionBlocked, injectionScanned, sensitivityBlocked, recentHallucinations] =
      await Promise.all([
        this.prisma.llmHallucinationLog.count({ where: { userId, timestamp: { gte: from } } }),
        this.prisma.auditEvent.count({
          where: {
            userId,
            action: 'security.audit.injection_blocked',
            timestamp: { gte: from },
          },
        }),
        this.prisma.auditEvent.count({
          where: {
            userId,
            action: 'security.audit.injection_scanned',
            timestamp: { gte: from },
          },
        }),
        this.prisma.auditEvent.count({
          where: {
            userId,
            action: 'security.audit.sensitivity_blocked',
            timestamp: { gte: from },
          },
        }),
        this.prisma.llmHallucinationLog.findMany({
          where: { userId, timestamp: { gte: from } },
          orderBy: { timestamp: 'desc' },
          take: 10,
          select: {
            id: true,
            promptId: true,
            promptVersion: true,
            timestamp: true,
            suspectFragments: true,
          },
        }),
      ]);
    return {
      window,
      hallucinationSuspectCount: hallucinations,
      injectionBlockedCount: injectionBlocked,
      injectionScannedCount: injectionScanned,
      sensitivityBlockedCount: sensitivityBlocked,
      recentHallucinations: recentHallucinations.map((h) => ({
        id: h.id,
        promptId: h.promptId,
        promptVersion: h.promptVersion,
        timestamp: h.timestamp.toISOString(),
        suspectFragmentCount: h.suspectFragments.length,
      })),
    };
  }

  /**
   * Simple ratio-based anomaly: today's cost vs the median of the
   * previous 7 days. Ratios: <2x = ok, 2x-3x = warn, >3x = critical.
   * ponytail: not statistical anomaly detection, but catches the "typo
   * ran the batch job 100x" case which is the real-world win here.
   */
  async detectAnomaly(userId: string, window: Window = '7d'): Promise<AnomalyReport> {
    const days = WINDOW_DAYS[window];
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);
    const from = new Date(startOfToday.getTime() - days * 86_400_000);
    const rows = await this.prisma.llmCall.findMany({
      where: { userId, timestamp: { gte: from } },
      select: { timestamp: true, costUsd: true },
    });
    const byDay = new Map<string, number>();
    for (const r of rows) {
      const key = r.timestamp.toISOString().slice(0, 10);
      byDay.set(key, (byDay.get(key) ?? 0) + Number(r.costUsd ?? 0));
    }
    const todaysKey = startOfToday.toISOString().slice(0, 10);
    const todays = byDay.get(todaysKey) ?? 0;
    const prior = [...byDay.entries()]
      .filter(([k]) => k !== todaysKey)
      .map(([, v]) => v);
    prior.sort((a, b) => a - b);
    const median =
      prior.length === 0 ? 0 : prior.length % 2 === 1 ? prior[Math.floor(prior.length / 2)]! : (prior[prior.length / 2 - 1]! + prior[prior.length / 2]!) / 2;
    const ratio = median > 0 ? todays / median : null;
    let severity: AnomalyReport['severity'] = 'none';
    let flagged = false;
    let cause: string | null = null;
    if (ratio !== null) {
      if (ratio >= 3) {
        severity = 'critical';
        flagged = true;
        cause = `today's cost is ${ratio.toFixed(1)}x the rolling median`;
      } else if (ratio >= 2) {
        severity = 'warn';
        flagged = true;
        cause = `today's cost is ${ratio.toFixed(1)}x the rolling median`;
      }
    }
    return {
      window,
      todaysCostUsd: round(todays),
      rollingMedianCostUsd: round(median),
      ratio: ratio !== null ? round(ratio) : null,
      flagged,
      severity,
      cause,
    };
  }

  async exportCalls(
    userId: string,
    window: Window,
    format: ExportFormat,
  ): Promise<{ contentType: string; body: string; filename: string }> {
    const days = WINDOW_DAYS[window];
    const from = new Date(Date.now() - days * 86_400_000);
    const rows = await this.prisma.llmCall.findMany({
      where: { userId, timestamp: { gte: from } },
      orderBy: { timestamp: 'desc' },
      select: {
        id: true,
        timestamp: true,
        provider: true,
        model: true,
        callKind: true,
        promptTokens: true,
        completionTokens: true,
        totalTokens: true,
        costUsd: true,
        latencyMs: true,
        ok: true,
      },
    });
    const filenameBase = `usage-${userId}-${window}-${new Date().toISOString().slice(0, 10)}`;
    if (format === 'json') {
      return {
        contentType: 'application/json',
        body: JSON.stringify(
          rows.map((r) => ({
            ...r,
            timestamp: r.timestamp.toISOString(),
            costUsd: r.costUsd ? Number(r.costUsd) : null,
          })),
          null,
          2,
        ),
        filename: `${filenameBase}.json`,
      };
    }
    const header = EXPORT_COLUMNS.join(',');
    const csvRows = rows.map((r) =>
      EXPORT_COLUMNS.map((c) => {
        const v = r[c as keyof typeof r];
        if (v === null || v === undefined) return '';
        if (v instanceof Date) return v.toISOString();
        if (typeof v === 'string') return csvEscape(v);
        if (typeof v === 'boolean') return v ? 'true' : 'false';
        return String(v);
      }).join(','),
    );
    return {
      contentType: 'text/csv; charset=utf-8',
      body: [header, ...csvRows].join('\n') + '\n',
      filename: `${filenameBase}.csv`,
    };
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx]!;
}

function round(n: number, digits = 4): number {
  const m = 10 ** digits;
  return Math.round(n * m) / m;
}

function csvEscape(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
