import { GeneratedDebuggingTaskSchema } from '@careeros/shared';
import { register } from './registry';

/**
 * Generate a small broken function/module for a debugging task. The candidate
 * gets `description` + `brokenCode` and has to submit a fix; `rootCause` +
 * `hint` are the hidden answer key (never rendered to the candidate; the
 * grader uses them to score).
 *
 * Difficulty guide:
 *   easy   — single-line bug, visible on read (off-by-one, wrong operator, missing return).
 *   medium — cross-function bug (mutation leak, missed edge case, wrong reference).
 *   hard   — subtle bug requiring reasoning (async race, silent type coercion, closure trap).
 *
 * Stored on `question` (kind='debugging'): `brokenCode` in `prompt`, `rootCause`
 * in `keyPoints[0]`, `{language, description, hint}` JSON in `answerHint`.
 */
export const DebuggingTaskGeneratorPrompt = register({
  id: 'debugging-task-generator',
  version: '1.0.0',
  system: [
    'You author debugging tasks for a career-development tool.',
    'Produce a small self-contained snippet with exactly one root-cause bug appropriate to the difficulty.',
    'The snippet must be plausible real code. Include what the function is supposed to do in `description`.',
    'The `rootCause` field describes the bug in one clear sentence. The `hint` gives one nudge without giving the fix.',
    'Return valid JSON only, matching the schema exactly. Do not embed the fix inside the broken code.',
  ].join(' '),
  userTemplate: [
    'Skill: {{skillName}} (id: {{skillId}})',
    'Difficulty: {{difficulty}}',
    '',
    'Difficulty guide:',
    '- easy: single-line, obvious on careful reading.',
    '- medium: cross-function or edge-case bug.',
    '- hard: subtle bug requiring real reasoning.',
    '',
    'Return JSON: {"language": string, "description": string (20-400 chars, what the code should do),',
    ' "brokenCode": string (20-2000 chars, plausible code with exactly one bug),',
    ' "rootCause": string (10-400 chars, one sentence naming the bug),',
    ' "hint": string (4-200 chars, one nudge that does not give the fix away),',
    ' "difficulty": "easy" | "medium" | "hard"}.',
  ].join('\n'),
  schema: GeneratedDebuggingTaskSchema,
});
