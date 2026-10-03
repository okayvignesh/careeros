import type { PinoLogger } from 'nestjs-pino';
import type { LlmCallHook, LlmCallRecord } from '@careeros/ai';
import { estimateCostBreakdown, estimateCostUsd } from '@careeros/ai';
import type { PrismaService } from '../prisma/prisma.service';
import type { UsageCache } from '../modules/usage/usage.cache';
import type { MetricsService } from './metrics/metrics.service';

/**
 * Backpressure-safe audit sink (ai-safety.md item 9). Provider `onCall` hooks
 * are fire-and-forget, but a slow DB must not let unbounded writes pile up in
 * memory or exhaust the connection pool. This bounded queue caps concurrent
 * writes and queue depth; anything beyond the depth is dropped *loudly* (warn +
 * `careeros_llm_audit_dropped_total`), never silently. DB write failures are
 * logged + counted the same way, so the "lost audit rows" number is visible.
 *
 * Module-level so every provider instance (loaded per request via
 * ProviderLoaderService) shares one global ceiling.
 */
export const LLM_AUDIT_MAX_CONCURRENT = 4;
export const LLM_AUDIT_MAX_QUEUE = 1_000;

type RunResult = 'ok' | 'dropped';

class BoundedAuditQueue {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  private dropped = 0;

  constructor(
    private readonly maxConcurrent: number,
    private readonly maxQueue: number,
  ) {}

  get droppedCount(): number {
    return this.dropped;
  }

  run(task: () => Promise<void>): Promise<RunResult> {
    return new Promise<RunResult>((resolve) => {
      const start = (): void => {
        this.active += 1;
        void task()
          .catch(() => {
            /* task owns its error handling; never reject the queue */
          })
          .then(() => {
            this.active -= 1;
            const next = this.waiting.shift();
            if (next) next();
            resolve('ok');
          });
      };
      if (this.active < this.maxConcurrent) {
        start();
      } else if (this.waiting.length < this.maxQueue) {
        this.waiting.push(start);
      } else {
        this.dropped += 1;
        resolve('dropped');
      }
    });
  }
}

export const llmAuditQueue = new BoundedAuditQueue(LLM_AUDIT_MAX_CONCURRENT, LLM_AUDIT_MAX_QUEUE);

/**
 * Builds an `onCall` hook bound to a specific user. Passed to the provider so
 * every call writes one `llm_calls` row with prompt id/hash, sensitivity,
 * tokens, cost split, latency, and validation verdict (ai-safety.md item 9).
 * The provider fires the hook fire-and-forget; this hook submits to the bounded
 * queue and resolves once its own row is written (tests await it directly).
 */
export function makeLlmAuditor(
  prisma: PrismaService,
  userId: string | null,
  logger?: PinoLogger,
  cache?: UsageCache,
  metrics?: MetricsService,
): LlmCallHook {
  return async (r: LlmCallRecord) => {
    const cost =
      r.promptTokens != null && r.completionTokens != null
        ? estimateCostBreakdown(r.provider, r.model, r.promptTokens, r.completionTokens)
        : null;
    const costUsd =
      cost?.costTotal ??
      (r.promptTokens != null && r.completionTokens != null
        ? estimateCostUsd(r.provider, r.model, r.promptTokens, r.completionTokens)
        : null);

    // C-P4.8: emit Prometheus metrics alongside the DB row. Kept optional so
    // legacy callers that haven't been rewired still work.
    if (metrics) {
      metrics.llmCallsTotal.inc({
        provider: r.provider,
        model: r.model,
        ok: String(r.ok),
      });
      metrics.llmCallDurationSeconds.observe(
        { provider: r.provider, model: r.model },
        r.latencyMs / 1000,
      );
      if (r.promptTokens != null) {
        metrics.llmTokensTotal.inc(
          { provider: r.provider, model: r.model, kind: 'input' },
          r.promptTokens,
        );
      }
      if (r.completionTokens != null) {
        metrics.llmTokensTotal.inc(
          { provider: r.provider, model: r.model, kind: 'output' },
          r.completionTokens,
        );
      }
    }

    const result = await llmAuditQueue.run(async () => {
      try {
        await prisma.llmCall.create({
          data: {
            userId,
            provider: r.provider,
            model: r.model,
            callKind: r.callKind,
            promptId: r.promptId ?? null,
            promptVersion: r.promptVersion ?? null,
            promptHash: r.promptHash ?? null,
            sensitivity: r.sensitivity ?? null,
            agentRole: r.agentRole ?? null,
            promptTokens: r.promptTokens,
            completionTokens: r.completionTokens,
            totalTokens: r.totalTokens,
            estimatedPromptTokens: r.estimatedPromptTokens ?? null,
            costInput: cost?.costInput ?? null,
            costOutput: cost?.costOutput ?? null,
            costUsd,
            pricingVersion: cost?.pricingVersion ?? null,
            latencyMs: r.latencyMs,
            ok: r.ok,
            validation: r.validation ?? null,
            cacheHit: r.cacheHit ?? false,
            error: r.error ?? null,
          },
        });
        if (cache) await cache.bumpVersion(userId);
      } catch (err) {
        // Row lost, but the loss is logged + counted (never silent).
        metrics?.llmAuditDroppedTotal.inc({ reason: 'db_error' });
        warn(
          logger,
          { err: (err as Error).message, userId, provider: r.provider, model: r.model },
          'llm audit write failed',
        );
      }
    });

    if (result === 'dropped') {
      metrics?.llmAuditDroppedTotal.inc({ reason: 'queue_full' });
      warn(
        logger,
        { userId, provider: r.provider, model: r.model, dropped: llmAuditQueue.droppedCount },
        'llm audit queue full; row dropped',
      );
    }
  };
}

function warn(
  logger: PinoLogger | undefined,
  ctx: Record<string, unknown>,
  msg: string,
): void {
  if (logger) {
    logger.warn(ctx, msg);
  } else {
    // Fallback for callers that didn't wire pino. Boot/test only.
    // eslint-disable-next-line no-console
    console.warn('[llm-audit]', msg, ctx);
  }
}
