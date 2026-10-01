import { GeneratedBuildTaskSchema } from '@careeros/shared';

// ponytail: one consumer (assessments.service.ts) so this skips the @careeros/ai
// prompt registry; promote to the shared registry if a second module ever needs it.
//
// Contract: tests emit exactly one `PASS <name>` or `FAIL <name>` line per case on
// stdout. Grader runs `starter + candidateCode + tests` in the sandbox and parses
// those lines. Keep tasks small (10-20 min, 3-6 tests).

const SYSTEM = [
  'You author small build tasks for a career-development tool.',
  'The candidate reads `description`, edits `starter` to implement the required functionality, and submits.',
  'The grader runs `starter + candidateCode + tests` inside a sealed sandbox (no network, no filesystem writes outside /tmp) and parses stdout.',
  'Your `tests` block MUST print exactly one line per test case, each line being either `PASS <short_name>` or `FAIL <short_name>` on failure. No other PASS/FAIL markers anywhere.',
  'Keep the task small enough to solve in 10-20 minutes with 3-6 tests.',
  'Return valid JSON only, matching the schema exactly. Never embed the solution inside `starter` or `description`.',
].join(' ');

const USER_TEMPLATE = [
  'Skill: {{skillName}} (id: {{skillId}})',
  'Difficulty: {{difficulty}}',
  '',
  'Difficulty guide:',
  '- easy: one function, 3 tests, straight algorithmic.',
  '- medium: 2-3 collaborating functions, 4-5 tests, one edge case.',
  '- hard: small module with state, 5-6 tests, concurrency or boundary bugs expected.',
  '',
  'Language must be one of: node, python, go, typescript.',
  '',
  'Return JSON matching the GeneratedBuildTaskSchema. The `tests` string MUST be runnable in the same file as `starter` + the candidate submission and emit PASS/FAIL lines.',
].join('\n');

export function renderBuildTaskPrompt(vars: {
  skillId: string;
  skillName: string;
  difficulty: string;
}): { system: string; user: string; schema: typeof GeneratedBuildTaskSchema } {
  const user = USER_TEMPLATE.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const v = (vars as Record<string, string>)[name];
    if (v === undefined) throw new Error(`build-task-generator missing variable '{{${name}}}'`);
    return v;
  });
  return { system: SYSTEM, user, schema: GeneratedBuildTaskSchema };
}
