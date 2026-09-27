import { FactCheckResultSchema } from '@careeros/shared';
import { UNTRUSTED_SYSTEM_CLAUSE } from '../wrap';
import { register } from './registry';

/**
 * Verify that every bullet in a generated resume is actually supported by
 * its cited facts. Cited-fact-ID validity is already enforced upstream; this
 * pass checks that the bullet's TEXT doesn't invent claims beyond what the
 * cited fact content says (numbers, scope, seniority, technologies, dates).
 *
 * Batched: one call per resume, each bullet indexed, per-index verdict + short
 * reason. `supported=false` bullets get dropped by the service before persist.
 */
export const ResumeBulletFactCheckPrompt = register({
  id: 'resume-bullet-fact-check',
  version: '1.0.0',
  system: [
    'You audit resume bullets for factual grounding.',
    'A bullet is SUPPORTED when every specific claim in its text (numbers, technologies, scope, dates, seniority, outcomes) is either explicitly present in the cited fact content OR is a fair rephrasing that does not add new claims.',
    'A bullet is NOT SUPPORTED when it adds a metric, technology, scope, or outcome that no cited fact mentions, even if similar-sounding.',
    'Generic language ("collaborated with the team", "delivered features") counts as SUPPORTED when the underlying employment/project fact exists.',
    'Return valid JSON only, matching the schema exactly. One result per bullet, keyed by bulletIndex.',
    UNTRUSTED_SYSTEM_CLAUSE,
  ].join(' '),
  userTemplate: [
    'Audit each bullet against its cited fact content.',
    '',
    'Bullets (each labelled with its bulletIndex + the fact content each cites):',
    '{{bullets}}',
    '',
    'Return JSON: {"results": [{"bulletIndex": number, "supported": boolean, "reason": string (<=400 chars, one sentence)}] (one entry per bulletIndex you were shown)}.',
  ].join('\n'),
  schema: FactCheckResultSchema,
});
