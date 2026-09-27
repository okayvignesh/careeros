import { RubricGradeSchema } from '@careeros/shared';
import { UNTRUSTED_SYSTEM_CLAUSE } from '../wrap';
import { register } from './registry';

/**
 * Grade a candidate's system-design write-up against a rubric. Rubric dimensions
 * + level descriptors are inlined into the prompt (the caller renders them from
 * the shared `SYSTEM_DESIGN_RUBRIC`). Grader returns one score per dimension
 * with a short note citing evidence from the design; overall score = mean/5.
 *
 * Design text is untrusted user content — wrapped via `wrapUntrusted` so the
 * grader can't be re-instructed by embedded prose.
 */
export const SystemDesignGraderPrompt = register({
  id: 'system-design-grader',
  version: '1.0.0',
  system: [
    'You grade a candidate\'s system-design write-up against a supplied rubric.',
    'For each rubric dimension, pick the level (1..5) whose descriptor best matches the design and cite the evidence in one short note.',
    'Do not invent claims that are not in the design. Do not reward buzzwords absent from the design text.',
    'Overall score = mean of dimension scores / 5, in [0, 1].',
    'Return valid JSON only, matching the schema exactly. `dimensions[]` must cover every dimension in the rubric, in the same order.',
    UNTRUSTED_SYSTEM_CLAUSE,
  ].join(' '),
  userTemplate: [
    'Scenario:',
    '{{scenario}}',
    '',
    'Constraints:',
    '{{constraints}}',
    '',
    'Rubric (dimensions × levels):',
    '{{rubric}}',
    '',
    'Candidate design:',
    '{{design}}',
    '',
    'Return JSON: {"score": number in [0,1], "dimensions": [{"dimensionId": string, "score": 1..5, "notes": string (<=400 chars)}], "reasoning": string (<=1000 chars)}.',
  ].join('\n'),
  schema: RubricGradeSchema,
});
