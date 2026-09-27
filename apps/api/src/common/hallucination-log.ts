import { createHash } from 'node:crypto';
import type { PinoLogger } from 'nestjs-pino';
import type { HallucinationHook, HallucinationReport } from '@careeros/ai';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Builds an onHallucination hook bound to a specific user. Passed to `generateGrounded`
 * so any suspect fragments (numbers/dates/companies/proper-nouns in the output that
 * aren't in the injected facts) land in `llm_hallucination_log`.
 *
 * Fire-and-forget: `generateGrounded` never awaits this; Prisma failures log at warn.
 *
 * A-M4: `sourceText` (the resume / job description / email body the model was fed)
 * is optional. When present the row stores:
 *   - `snippetHash`     sha256 of the full source (32 hex chars, 128 bits truncated)
 *   - `snippetOffset`   {start, end} byte offsets of the first suspect fragment in
 *                       the source, so an eval reviewer can jump straight to it
 *   - `snippet`         raw excerpt (encrypted at rest by PrismaService middleware
 *                       via ENCRYPTED_FIELDS: LlmHallucinationLog.snippet), only
 *                       written when the caller asks for it via `includeRawSnippet`.
 * Rows age out after 30 days via the `hallucination-log-retention` worker.
 */
export function makeHallucinationLogger(
  prisma: PrismaService,
  userId: string | null,
  logger?: PinoLogger,
  opts: { sourceText?: string; includeRawSnippet?: boolean } = {},
): HallucinationHook {
  return async (report, meta) => {
    if (report.suspects.length === 0) return;
    try {
      const snippetInfo = buildSnippet(report, opts);
      await prisma.llmHallucinationLog.create({
        data: {
          userId,
          promptId: meta.promptId,
          promptVersion: meta.promptVersion,
          promptHash: meta.promptHash,
          suspectFragments: report.suspects.slice(0, 200),
          detail: report.byKind as unknown as import('@prisma/client').Prisma.InputJsonValue,
          snippet: snippetInfo.snippet,
          snippetHash: snippetInfo.hash,
          snippetOffset: snippetInfo.offset as unknown as import('@prisma/client').Prisma.InputJsonValue,
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

const SNIPPET_CONTEXT = 60;

function buildSnippet(
  report: HallucinationReport,
  opts: { sourceText?: string; includeRawSnippet?: boolean },
): { snippet: string | null; hash: string | null; offset: { start: number; end: number } | null } {
  if (!opts.sourceText) return { snippet: null, hash: null, offset: null };
  const src = opts.sourceText;
  const hash = createHash('sha256').update(src, 'utf8').digest('hex').slice(0, 32);
  const firstSuspect = report.suspects.find((s) => s && src.includes(s));
  if (!firstSuspect) {
    return { snippet: null, hash, offset: null };
  }
  const start = src.indexOf(firstSuspect);
  const end = start + firstSuspect.length;
  const excerptStart = Math.max(0, start - SNIPPET_CONTEXT);
  const excerptEnd = Math.min(src.length, end + SNIPPET_CONTEXT);
  const snippet = opts.includeRawSnippet ? src.slice(excerptStart, excerptEnd) : null;
  return { snippet, hash, offset: { start, end } };
}
