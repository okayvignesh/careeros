import { DebuggingGradeSchema } from '@careeros/shared';
import { UNTRUSTED_SYSTEM_CLAUSE } from '../wrap';
import { register } from './registry';

/**
 * Grade a debugging attempt. Given the broken code, the hidden root cause,
 * and the candidate's fix (wrapped as untrusted), return two component scores:
 *   correctness ∈ [0,1] — does the fix actually address the root cause?
 *   minimality  ∈ [0,1] — did they change only what needed changing?
 * Overall `score` = weighted mean (correctness heavier); the exact weight is
 * the grader's judgement, stated in `reasoning`.
 *
 * The grader must read the fix carefully. Cosmetic changes without addressing
 * the root cause = correctness 0.
 */
export const DebuggingTaskGraderPrompt = register({
  id: 'debugging-task-grader',
  version: '1.0.0',
  system: [
    'You grade a debugging attempt.',
    'Judge whether the candidate\'s fix addresses the described root cause.',
    'Cosmetic changes that do not fix the root cause score 0 on correctness, regardless of minimality.',
    'Small, targeted fixes score high on minimality; sweeping rewrites lower it.',
    'Return valid JSON only, matching the schema exactly.',
    UNTRUSTED_SYSTEM_CLAUSE,
  ].join(' '),
  userTemplate: [
    'What the code should do:',
    '{{description}}',
    '',
    'Broken code:',
    '{{brokenCode}}',
    '',
    'Hidden root cause (do not reveal in reasoning):',
    '{{rootCause}}',
    '',
    'Candidate fix:',
    '{{fix}}',
    '',
    'Return JSON: {"score": number in [0,1], "correctness": number in [0,1],',
    ' "minimality": number in [0,1], "reasoning": string (<=1000 chars, why the score)}.',
  ].join('\n'),
  schema: DebuggingGradeSchema,
});
