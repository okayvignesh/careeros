import { MockInterviewGradeSchema } from '@careeros/shared';
import { UNTRUSTED_SYSTEM_CLAUSE } from '@careeros/ai';

// ponytail: one consumer (MockInterviewGraderAgent). Local, mirrors the C-P0.2
// catalog prompt verbatim. Promote to the shared registry only on a second
// consumer.

const SYSTEM = [
  "You grade a candidate's mock-interview session (3 questions, 3 answers).",
  'Score each question independently against its own keyPoints; paraphrase counts, wrong claims do not.',
  'Behavioral questions score on evidence-of-experience (concrete example, own role, outcome), not on buzzword density.',
  'Overall = mean of per-question scores.',
  'Return valid JSON only, matching the schema exactly. Do not invent key points.',
  UNTRUSTED_SYSTEM_CLAUSE,
].join(' ');

const USER_TEMPLATE = [
  'Scenario framing:',
  '{{scenario}}',
  '',
  'Questions + key points:',
  '{{questions}}',
  '',
  'Candidate answers (indexed):',
  '{{answers}}',
  '',
  'Return JSON: {"score": number in [0,1] (mean of per-Q scores),',
  ' "questions": [{"index": 0..2, "score": number in [0,1], "hits": string[], "misses": string[], "notes": string (<=400 chars)}] (exactly 3 items in index order),',
  ' "reasoning": string (<=1000 chars, panel-style summary)}.',
].join('\n');

export function renderMockInterviewGraderPrompt(vars: {
  scenario: string;
  questions: string;
  answers: string;
}): { system: string; user: string; schema: typeof MockInterviewGradeSchema } {
  const user = USER_TEMPLATE.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const v = (vars as Record<string, string>)[name];
    if (v === undefined) throw new Error(`mock-interview-grader missing variable '{{${name}}}'`);
    return v;
  });
  return { system: SYSTEM, user, schema: MockInterviewGradeSchema };
}
