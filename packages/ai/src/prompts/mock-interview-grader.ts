import { MockInterviewGradeSchema } from '@careeros/shared';
import { UNTRUSTED_SYSTEM_CLAUSE } from '../wrap';
import { register } from './registry';

/**
 * Grade a single-turn mock interview: 3 questions, 3 answers, per-question
 * score + overall + panel-style summary. Answers are wrapped as untrusted.
 * Grader must score each Q independently against its own keyPoints, then set
 * overall = mean of per-question scores.
 */
export const MockInterviewGraderPrompt = register({
  id: 'mock-interview-grader',
  version: '1.0.0',
  system: [
    'You grade a candidate\'s mock-interview session (3 questions, 3 answers).',
    'Score each question independently against its own keyPoints; paraphrase counts, wrong claims do not.',
    'Behavioral questions score on evidence-of-experience (concrete example, own role, outcome), not on buzzword density.',
    'Overall = mean of per-question scores.',
    'Return valid JSON only, matching the schema exactly. Do not invent key points.',
    UNTRUSTED_SYSTEM_CLAUSE,
  ].join(' '),
  userTemplate: [
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
  ].join('\n'),
  schema: MockInterviewGradeSchema,
});
