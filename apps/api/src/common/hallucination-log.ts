import type { PinoLogger } from 'nestjs-pino';
import type { HallucinationHook } from '@careeros/ai';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Builds an onHallucination hook bound to a specific user. Passed to `generateGrounded`
 * so any suspect fragments (numbers/dates/companies/proper-nouns in the output that
 * aren't in the injected facts) land in `llm_hallucination_log`.
 *
 * Fire-and-forget: `generateGrounded` never awaits this; Prisma failures log at warn.
 */
export function makeHallucinationLogger(
  prisma: PrismaService,
  userId: string | null,
  logger?: PinoLogger,
): HallucinationHook {
  return async (report, meta) => {
    if (report.suspects.length === 0) return;
    try {
      await prisma.llmHallucinationLog.create({
        data: {
          userId,
          promptId: meta.promptId,
          promptVersion: meta.promptVersion,
          promptHash: meta.promptHash,
          suspectFragments: report.suspects.slice(0, 200),
          detail: report.byKind as unknown as import('@prisma/client').Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      const msg = (err as Error).message;
      if (logger) {
        logger.warn(
          { err: msg, userId, promptId: meta.promptId, suspects: report.suspects.length },
          'hallucination log write failed',
        );
      } else {
        // eslint-disable-next-line no-console
        console.warn('[hallucination-log]', msg);
      }
    }
  };
}
