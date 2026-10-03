import type { PinoLogger } from 'nestjs-pino';
import {
  setInjectionAuditHook,
  setWrapAuditHook,
  type InjectionAuditEvent,
  type WrapAuditEvent,
} from '@careeros/ai';
import type { PrismaService } from '../prisma/prisma.service';
import type { MetricsService } from './metrics/metrics.service';

/**
 * ai-safety.md item 5: dedicated injection audit trail. The `wrapUntrusted` /
 * `auditScan` boundaries already emit a structured event when content is
 * flagged suspect/blocked; this persists one `llm_injection_log` row per flag
 * (source kind, snippet hash/offset, score/severity, action taken) so the audit
 * UI can review it independently of the domain `audit_log` rows the callers
 * also write.
 *
 * Fire-and-forget, matching the hallucination logger: the boundary must never
 * block or throw on an audit write. DB errors log at warn + count.
 */
export async function persistInjectionEvent(
  prisma: PrismaService,
  evt: WrapAuditEvent | InjectionAuditEvent,
  logger?: Pick<PinoLogger, 'warn'>,
  metrics?: MetricsService,
): Promise<void> {
  const sourceKind = 'sourceKind' in evt ? evt.sourceKind : evt.kind;
  try {
    await prisma.llmInjectionLog.create({
      data: {
        userId: evt.userId ?? null,
        sourceKind,
        promptId: evt.promptId ?? null,
        severity: evt.severity,
        score: evt.score,
        action: evt.action,
        hits: evt.hits.map((h) => h.kind),
        snippet: evt.snippet,
        snippetHash: evt.contentHash,
        snippetOffset: evt.snippetOffset as unknown as import('@prisma/client').Prisma.InputJsonValue,
      },
    });
    metrics?.llmInjectionFlagsTotal.inc({ severity: evt.severity, action: evt.action });
  } catch (err) {
    metrics?.injectionLogDroppedTotal.inc({ reason: 'db_error' });
    const ctx = { err: (err as Error).message, sourceKind, severity: evt.severity };
    if (logger) logger.warn(ctx, 'injection log write failed');
    // eslint-disable-next-line no-console
    else console.warn('[injection-log]', ctx);
  }
}

/** Awaitable + throw-free seam for tests and direct callers. */
export function makeInjectionLogger(
  prisma: PrismaService,
  logger?: Pick<PinoLogger, 'warn'>,
  metrics?: MetricsService,
): (evt: WrapAuditEvent | InjectionAuditEvent) => void {
  return (evt) => {
    void persistInjectionEvent(prisma, evt, logger, metrics);
  };
}

/**
 * Install the process-wide wrap + scan audit hooks. Called once at boot by
 * `InjectionAuditModule`; returns a teardown for tests / shutdown.
 */
export function installInjectionAuditHooks(
  prisma: PrismaService,
  logger?: Pick<PinoLogger, 'warn'>,
  metrics?: MetricsService,
): () => void {
  const hook = makeInjectionLogger(prisma, logger, metrics);
  setWrapAuditHook(hook);
  setInjectionAuditHook(hook);
  return () => {
    setWrapAuditHook(null);
    setInjectionAuditHook(null);
  };
}
