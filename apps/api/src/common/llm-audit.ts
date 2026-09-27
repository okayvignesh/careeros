import type { PinoLogger } from 'nestjs-pino';
import type { LlmCallHook } from '@careeros/ai';
import { estimateCostUsd } from '@careeros/ai';
import type { PrismaService } from '../prisma/prisma.service';
import type { UsageCache } from '../modules/usage/usage.cache';
import type { MetricsService } from './metrics/metrics.service';

/**
 * Builds an onCall hook bound to a specific user. Passed to DeepSeekProvider so
 * every provider call writes one llm_calls row with tokens, cost, and latency.
 * The provider fires the hook fire-and-forget; if Prisma is down or the schema
 * is out of sync, we log a warn so the ledger gap is visible instead of silent.
 */
export function makeLlmAuditor(
  prisma: PrismaService,
  userId: string | null,
  logger?: PinoLogger,
  cache?: UsageCache,
  metrics?: MetricsService,
): LlmCallHook {
  return async (r) => {
    const costUsd =
      r.promptTokens != null && r.completionTokens != null
        ? estimateCostUsd(r.provider, r.model, r.promptTokens, r.completionTokens)
        : null;

    // C-P4.8: emit Prometheus metrics alongside the DB row. Kept optional so
    // legacy callers that haven't been rewired still work; every real caller
    // wires metrics via the constructor.
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
    try {
      await prisma.llmCall.create({
        data: {
          userId,
          provider: r.provider,
          model: r.model,
          callKind: r.callKind,
          promptTokens: r.promptTokens,
          completionTokens: r.completionTokens,
          totalTokens: r.totalTokens,
          costUsd,
          latencyMs: r.latencyMs,
          ok: r.ok,
          error: r.error ?? null,
        },
      });
      if (cache) await cache.bumpVersion(userId);
    } catch (err) {
      const msg = (err as Error).message;
      if (logger) {
        logger.warn({ err: msg, userId, provider: r.provider, model: r.model }, 'llm audit write failed');
      } else {
        // Fallback for callers that didn't wire pino. Boot-time only; app code should pass logger.
        // eslint-disable-next-line no-console
        console.warn('[llm-audit]', msg);
      }
    }
  };
}
