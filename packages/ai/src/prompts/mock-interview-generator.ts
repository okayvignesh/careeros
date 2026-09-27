import { GeneratedMockInterviewSchema } from '@careeros/shared';
import { register } from './registry';

/**
 * Generate a single-turn mock interview: 3 questions total (2 technical + 1
 * behavioral). Walking-skeleton — the plan's multi-turn panel-orchestrated
 * variant lands with the mock_sessions table in a later slice.
 *
 * Every question carries its own keyPoints so the grader can score per-Q
 * without a separate rubric. Behavioral questions should reference the
 * candidate's actual work indirectly (via generic themes like "led a
 * migration" or "handled disagreement") — the grader will use those as
 * evidence-hint keyPoints.
 *
 * Stored on `question` (kind='mock-interview'): scenario in `prompt`, first
 * question's keyPoints in `keyPoints[]` (compat with existing infra),
 * `{scenario, questions}` full JSON in `answerHint` so the runner and grader
 * can rehydrate the 3-question shape.
 */
export const MockInterviewGeneratorPrompt = register({
  id: 'mock-interview-generator',
  version: '1.0.0',
  system: [
    'You author single-turn mock-interview batches for a career-development tool.',
    'Each batch is 3 questions total: 2 technical + 1 behavioral, in that order.',
    'Technical questions probe applied knowledge relevant to the skill; behavioral questions probe collaboration, decisions, ownership.',
    'Every question carries its own keyPoints (2-5 short phrases the grader will look for).',
    'Return valid JSON only, matching the schema exactly.',
  ].join(' '),
  userTemplate: [
    'Skill: {{skillName}} (id: {{skillId}})',
    'Difficulty: {{difficulty}}',
    '',
    'Batch shape: index 0 + 1 are `technical`, index 2 is `behavioral`.',
    'Difficulty guide:',
    '- easy: fundamental concepts, common scenarios.',
    '- medium: trade-offs and cross-cutting design decisions.',
    '- hard: unusual edge cases, subtle failure modes, senior-level judgement.',
    '',
    'Return JSON: {"scenario": string (10-300 chars, brief interview framing),',
    ' "questions": [{"kind": "technical"|"behavioral", "prompt": string (20-500 chars),',
    '   "keyPoints": string[] (1-5, each 2-80 chars)}] (exactly 3 items),',
    ' "difficulty": "easy" | "medium" | "hard"}.',
  ].join('\n'),
  schema: GeneratedMockInterviewSchema,
});
