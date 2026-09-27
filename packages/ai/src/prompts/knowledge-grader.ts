import { KnowledgeGradeSchema } from '@careeros/shared';
import { UNTRUSTED_SYSTEM_CLAUSE } from '../wrap';
import { register } from './registry';

/**
 * Knowledge-question grader. Given a question, its key points, and the user's
 * answer (wrapped as untrusted), returns {score in [0..1], hits, misses, reasoning}.
 *
 * Grading contract:
 *   - `score = fraction of key points meaningfully covered` (not a raw string match;
 *     paraphrase counts).
 *   - `hits[]` = key points the answer clearly addresses.
 *   - `misses[]` = key points not covered.
 *   - `reasoning` = one short sentence per interesting hit/miss, at most ~4 lines.
 *
 * The api layer calls `findHallucinations` on `reasoning` against the answer +
 * key points so the grader can't insert facts (a graded `fact` never becomes an
 * evidence claim itself; only the score does).
 */
export const KnowledgeGraderPrompt = register({
  id: 'knowledge-grader',
  version: '1.0.0',
  system: [
    'You grade a candidate\'s answer to a technical knowledge question.',
    'You are strict about factual correctness and generous about phrasing.',
    'Score = fraction of key points meaningfully covered, in [0, 1].',
    'Paraphrase counts; wrong claims do not.',
    'Return valid JSON only, matching the schema exactly. Do not invent key points.',
    UNTRUSTED_SYSTEM_CLAUSE,
  ].join(' '),
  userTemplate: [
    'Question:',
    '{{question}}',
    '',
    'Key points to look for (case-insensitive; paraphrase is fine):',
    '{{keyPoints}}',
    '',
    'Candidate answer:',
    '{{answer}}',
    '',
    'Return JSON: {"score": number in [0,1], "hits": string[], "misses": string[], "reasoning": string}.',
  ].join('\n'),
  schema: KnowledgeGradeSchema,
});
