import { z } from 'zod';
import { UNTRUSTED_SYSTEM_CLAUSE } from '@careeros/ai';

// ponytail: one consumer (VerbalDefenseGraderAgent). Local prompt, mirrors the
// mock-interview-grader pattern. Promote to the shared registry if a second
// consumer (P6 talk-track practice) starts using it.

/**
 * Grader output for a single spoken answer. `technicalAccuracy` and
 * `communication` are the two axes the phase-2 plan calls out; `score` is the
 * mean so an attempt's single score stays comparable to the other assessment
 * types.
 */
export const VerbalDefenseGradeSchema = z.object({
  score: z.number().min(0).max(1),
  technicalAccuracy: z.number().min(0).max(1),
  communication: z.number().min(0).max(1),
  hits: z.array(z.string()).default([]),
  misses: z.array(z.string()).default([]),
  reasoning: z.string().min(1).max(1000),
});
export type VerbalDefenseGrade = z.infer<typeof VerbalDefenseGradeSchema>;

const SYSTEM = [
  "You grade a candidate's spoken answer to an interview question from its transcript.",
  'Score technicalAccuracy on whether the answer covers the supplied key points (paraphrase counts, wrong claims do not).',
  'Score communication on structure, clarity and conciseness of the transcript; ignoring filler words is acceptable.',
  'Overall score = mean of technicalAccuracy and communication, in [0,1].',
  'Grade only the transcript. Never invent content that is not in it.',
  'Return valid JSON only, matching the schema exactly.',
  UNTRUSTED_SYSTEM_CLAUSE,
].join(' ');

const USER_TEMPLATE = [
  'Interview question:',
  '{{prompt}}',
  '',
  'Expected key points:',
  '{{keyPoints}}',
  '',
  'Candidate transcript:',
  '{{transcript}}',
  '',
  'Return JSON: {"score": number in [0,1], "technicalAccuracy": number in [0,1],',
  ' "communication": number in [0,1], "hits": string[], "misses": string[],',
  ' "reasoning": string (<=1000 chars)}.',
].join('\n');

export function renderVerbalDefenseGraderPrompt(vars: {
  prompt: string;
  keyPoints: string;
  transcript: string;
}): { system: string; user: string; schema: typeof VerbalDefenseGradeSchema } {
  const user = USER_TEMPLATE.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const v = (vars as Record<string, string>)[name];
    if (v === undefined) throw new Error(`verbal-defense-grader missing variable '{{${name}}}'`);
    return v;
  });
  return { system: SYSTEM, user, schema: VerbalDefenseGradeSchema };
}
