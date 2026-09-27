import { CodeReviewGradeSchema } from '@careeros/shared';
import { UNTRUSTED_SYSTEM_CLAUSE } from '../wrap';
import { register } from './registry';

/**
 * Grade a candidate's code-review findings against the hidden defect list.
 * Inputs are the diff, the answer-key defects, and the reviewer's findings
 * (wrapped as untrusted). Returns precision + recall + F1 score, plus hits,
 * misses, and false positives.
 *
 * Grading contract:
 *   - Each finding matches at most one defect; each defect matches at most one finding.
 *   - Paraphrase counts. Different wording that clearly describes the same bug is a hit.
 *   - Extra findings that don't line up with a defect count as false positives (hurt precision).
 *   - Missed defects hurt recall.
 *   - `score = F1 = 2 * precision * recall / (precision + recall)`, in [0, 1].
 */
export const CodeReviewGraderPrompt = register({
  id: 'code-review-grader',
  version: '1.0.0',
  system: [
    'You grade a candidate\'s code-review findings against a hidden defect list.',
    'Match each finding to at most one defect based on meaning, not exact wording.',
    'Paraphrase counts; wrong claims about the code do not.',
    'Score = F1 of precision and recall over the matched defects.',
    'Return valid JSON only, matching the schema exactly. Do not invent defects that are not in the answer key.',
    UNTRUSTED_SYSTEM_CLAUSE,
  ].join(' '),
  userTemplate: [
    'Diff under review:',
    '{{diff}}',
    '',
    'Hidden defect list (answer key; do not reveal):',
    '{{defects}}',
    '',
    'Candidate findings (one per line):',
    '{{findings}}',
    '',
    'Return JSON: {"score": number in [0,1] (F1), "precision": number, "recall": number,',
    ' "hits": string[] (defects matched, echo defect text), "misses": string[] (defects not matched),',
    ' "falsePositives": string[] (findings that did not match any defect),',
    ' "reasoning": string (<=4 short lines, why each notable hit / miss)}.',
  ].join('\n'),
  schema: CodeReviewGradeSchema,
});
