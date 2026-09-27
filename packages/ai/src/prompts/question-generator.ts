import { GeneratedQuestionSchema } from '@careeros/shared';
import { register } from './registry';

/**
 * Generate a single technical knowledge question for a given skill + difficulty.
 * No untrusted content: inputs are our own skill catalogue names, not user text,
 * so `UNTRUSTED_SYSTEM_CLAUSE` isn't needed here.
 *
 * Difficulty guidance the prompt bakes in:
 *   easy   — recall / core-concept identification.
 *   medium — mechanism / trade-off explanation.
 *   hard   — non-obvious edge case or scaling limit.
 *
 * The service (`AssessmentsService.generateKnowledgeQuestion`) validates the
 * response against `GeneratedQuestionSchema`, then upserts into `question_bank`
 * keyed by `promptHash` so re-generation with the same wording is a no-op.
 */
export const QuestionGeneratorPrompt = register({
  id: 'question-generator',
  version: '1.0.0',
  system: [
    'You author technical knowledge-check questions for a career-development tool.',
    'Each question is a single self-contained prompt a candidate can answer in 3-5 sentences.',
    'It probes real conceptual understanding, not trivia or vendor cargo-cult.',
    'You output JSON matching the schema exactly. Return valid JSON only, no prose around it.',
    'Do not repeat the skill name in the answer hint. Do not include the answer itself.',
    'Key points describe what a good answer must cover: 2-6 short phrases, no full sentences.',
  ].join(' '),
  userTemplate: [
    'Skill: {{skillName}} (id: {{skillId}})',
    'Difficulty: {{difficulty}}',
    '',
    'Difficulty guide:',
    '- easy: identify or recall a core concept.',
    '- medium: explain a mechanism or trade-off.',
    '- hard: a non-obvious edge case, failure mode, or scaling limit.',
    '',
    'Return JSON: {"prompt": string (40-800 chars), "keyPoints": string[] (2-6 short phrases),',
    ' "answerHint": string | null (1-200 chars, one nudge without giving the answer),',
    ' "difficulty": "easy" | "medium" | "hard"}.',
  ].join('\n'),
  schema: GeneratedQuestionSchema,
});
