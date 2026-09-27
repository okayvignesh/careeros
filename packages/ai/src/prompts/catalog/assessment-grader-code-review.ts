// C-P0.2a: catalog entry for the code-review grader prompt.
// Runtime rendering lives in ../code-review-grader.ts (PromptDef).
import type { Prompt } from './registry';

const system = [
  'You grade a candidate\'s code-review findings against a hidden defect list.',
  'Match each finding to at most one defect based on meaning, not exact wording.',
  'Paraphrase counts; wrong claims about the code do not.',
  'Score = F1 of precision and recall over the matched defects.',
  'Return valid JSON only, matching the schema exactly. Do not invent defects that are not in the answer key.',
].join(' ');

const user = [
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
].join('\n');

export const assessmentGraderCodeReview: Prompt = {
  id: 'assessment-grader-code-review',
  version: '1.0.0',
  schemaVersion: 'CodeReviewGradeSchema@1',
  description: 'Score reviewer findings against a hidden defect list via F1 (precision + recall).',
  template: `${system}\n\n${user}`,
};
