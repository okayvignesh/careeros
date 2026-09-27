import { KeyPointsExtractionSchema } from '@careeros/shared';
import { UNTRUSTED_SYSTEM_CLAUSE } from '../wrap';
import { register } from './registry';

/**
 * Given a question sourced from an external corpus (question is untrusted
 * content — could contain adversarial prose from a third-party markdown
 * file), extract 2-6 short key-point phrases the grader should look for in
 * a candidate's answer. No answer text — just the concepts a solid answer
 * has to cover.
 *
 * Called once per ingested question in `CorpusService.sync` so downstream
 * grading uses the same keyPoints[] contract as LLM-generated questions.
 */
export const KeyPointsExtractorPrompt = register({
  id: 'keypoints-extractor',
  version: '1.0.0',
  system: [
    'You extract the key concepts a strong answer to a technical question must cover.',
    'Return 2-6 short phrases, each 2-80 chars, no full sentences.',
    'These are grading targets, not answers. Do not include specific solutions, numbers, or code.',
    'Return valid JSON only, matching the schema exactly.',
    UNTRUSTED_SYSTEM_CLAUSE,
  ].join(' '),
  userTemplate: [
    'Question:',
    '{{question}}',
    '',
    'Return JSON: {"keyPoints": string[] (2-6 short phrases, each 2-80 chars)}.',
  ].join('\n'),
  schema: KeyPointsExtractionSchema,
});
