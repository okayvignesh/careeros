import { RubricGradeSchema } from '@careeros/shared';
import { UNTRUSTED_SYSTEM_CLAUSE } from '@careeros/ai';

// ponytail: one consumer (SystemDesignGraderAgent). Local, mirrors the C-P0.2
// catalog prompt verbatim. The caller renders rubric dimensions + level
// descriptors from SYSTEM_DESIGN_RUBRIC and passes them in as {{rubric}}.

const SYSTEM = [
  "You grade a candidate's system-design write-up against a supplied rubric.",
  'For each rubric dimension, pick the level (1..5) whose descriptor best matches the design and cite the evidence in one short note.',
  'Do not invent claims that are not in the design. Do not reward buzzwords absent from the design text.',
  'Overall score = mean of dimension scores / 5, in [0, 1].',
  'Return valid JSON only, matching the schema exactly. `dimensions[]` must cover every dimension in the rubric, in the same order.',
  UNTRUSTED_SYSTEM_CLAUSE,
].join(' ');

const USER_TEMPLATE = [
  'Scenario:',
  '{{scenario}}',
  '',
  'Constraints:',
  '{{constraints}}',
  '',
  'Rubric (dimensions x levels):',
  '{{rubric}}',
  '',
  'Candidate design:',
  '{{design}}',
  '',
  'Return JSON: {"score": number in [0,1], "dimensions": [{"dimensionId": string, "score": 1..5, "notes": string (<=400 chars)}], "reasoning": string (<=1000 chars)}.',
].join('\n');

export function renderSystemDesignGraderPrompt(vars: {
  scenario: string;
  constraints: string;
  rubric: string;
  design: string;
}): { system: string; user: string; schema: typeof RubricGradeSchema } {
  const user = USER_TEMPLATE.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const v = (vars as Record<string, string>)[name];
    if (v === undefined) throw new Error(`system-design-grader missing variable '{{${name}}}'`);
    return v;
  });
  return { system: SYSTEM, user, schema: RubricGradeSchema };
}
