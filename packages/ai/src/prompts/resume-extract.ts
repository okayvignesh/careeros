import { ExtractedFactsSchema } from '@careeros/shared';
import { UNTRUSTED_SYSTEM_CLAUSE } from '../wrap';
import { register } from './registry';

/**
 * Resume fact extraction. Input: the raw resume text (already wrapped by wrapUntrusted).
 * Output: {headline, location, employment[], education[], skills[], projects[]}.
 *
 * The prompt only allows the model to extract, not invent. The api layer calls
 * `findHallucinations(result, [rawText])` on the response and writes suspects to
 * `llm_hallucination_log`.
 */
export const ResumeExtractPrompt = register({
  id: 'resume-extract',
  version: '1.0.0',
  system: [
    'You extract structured facts from a resume. Return valid JSON only, matching the schema exactly.',
    'Do not invent details that are not in the resume text.',
    'Leave fields null when absent.',
    "Keep bullet points concise (one line each), preserve the resume's own phrasing.",
    UNTRUSTED_SYSTEM_CLAUSE,
  ].join(' '),
  userTemplate: [
    'Extract facts from this resume. Return JSON with keys:',
    'headline, location, employment[], education[], skills[], projects[].',
    'Each employment: {company, title, start, end, bullets[]}.',
    'Each education: {school, degree, field, year}.',
    'Each skill: {name, evidence}.',
    'Each project: {name, description}.',
    '',
    '{{resume}}',
  ].join('\n'),
  schema: ExtractedFactsSchema,
});
