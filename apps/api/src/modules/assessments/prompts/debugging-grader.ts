import { DebuggingGradeSchema } from '@careeros/shared';
import { UNTRUSTED_SYSTEM_CLAUSE } from '@careeros/ai';

// ponytail: one consumer (DebuggingGraderAgent). Keep local, mirror the C-P0.2
// catalog prompt. If a second module ever needs this prompt, promote to the
// shared registry.

const SYSTEM = [
  'You grade a debugging attempt.',
  "Judge whether the candidate's fix addresses the described root cause.",
  'Cosmetic changes that do not fix the root cause score 0 on correctness, regardless of minimality.',
  'Small, targeted fixes score high on minimality; sweeping rewrites lower it.',
  'Return valid JSON only, matching the schema exactly.',
  UNTRUSTED_SYSTEM_CLAUSE,
].join(' ');

const USER_TEMPLATE = [
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
].join('\n');

export function renderDebuggingGraderPrompt(vars: {
  description: string;
  brokenCode: string;
  rootCause: string;
  fix: string;
}): { system: string; user: string; schema: typeof DebuggingGradeSchema } {
  const user = USER_TEMPLATE.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const v = (vars as Record<string, string>)[name];
    if (v === undefined) throw new Error(`debugging-grader missing variable '{{${name}}}'`);
    return v;
  });
  return { system: SYSTEM, user, schema: DebuggingGradeSchema };
}
