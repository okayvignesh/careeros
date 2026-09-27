import { GeneratedCodeReviewSchema } from '@careeros/shared';
import { register } from './registry';

/**
 * Generate one small code-review task: a short unified-diff snippet with 2..4
 * intentional defects the reviewer should catch. No untrusted content — inputs
 * are our own skill catalogue names.
 *
 * Difficulty guidance baked into the prompt:
 *   easy   — one obvious defect + one subtle one.
 *   medium — two-to-three defects mixing correctness + style.
 *   hard   — three-to-four defects including at least one concurrency, security,
 *            or performance trap that survives casual reading.
 *
 * The service validates via `GeneratedCodeReviewSchema` and stores the diff in
 * `question.prompt`, the defect list (hidden answer key) in `question.keyPoints`,
 * and language + scenario in `question.answerHint`.
 */
export const CodeReviewGeneratorPrompt = register({
  id: 'code-review-generator',
  version: '1.0.0',
  system: [
    'You author code-review tasks for a career-development tool.',
    'Given a skill and difficulty, produce a small unified-diff snippet a reviewer can inspect in 5-10 minutes.',
    'Inject 2-4 intentional defects — bugs, security issues, style problems, or design smells — appropriate to the difficulty.',
    'The diff must be syntactically plausible; avoid placeholder ellipses like `// ...`.',
    'Return valid JSON only, matching the schema exactly. Do not include the defect list inside the diff itself.',
  ].join(' '),
  userTemplate: [
    'Skill: {{skillName}} (id: {{skillId}})',
    'Difficulty: {{difficulty}}',
    '',
    'Difficulty guide:',
    '- easy: one obvious defect + one subtle one.',
    '- medium: 2-3 defects mixing correctness + style.',
    '- hard: 3-4 defects including a concurrency, security, or performance trap.',
    '',
    'Return JSON: {"language": string, "scenario": string (20-400 chars describing the change under review),',
    ' "diff": string (unified-diff format, 40-3000 chars),',
    ' "defects": string[] (2-4, each 6-200 chars — one clear sentence per defect),',
    ' "difficulty": "easy" | "medium" | "hard"}.',
  ].join('\n'),
  schema: GeneratedCodeReviewSchema,
});
