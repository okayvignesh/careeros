// Seed eval suite for the question-generator prompt.
//
// Scores each generated question on:
//   - schemaValid          (must-pass; contributes 0.4)
//   - keyPointsInRange     (2..6 phrases; 0.15)
//   - promptLength         (>= 40, <= 800; 0.1)
//   - difficultyMatches    (0.15)
//   - skillRelevance       (any of the skill's aliases appears in prompt/hint; 0.2)
//
// The runner (`runner.ts::runEval`) passes only `(actual, expected)` to the
// scorer — no `input`. So everything the scorer needs (requested difficulty,
// skill aliases) lives in `expected`.
import { GeneratedQuestionSchema } from '@careeros/shared';
import type { EvalScore, EvalSuite } from './types';

interface Input {
  skillId: string;
  skillName: string;
  difficulty: 'easy' | 'medium' | 'hard';
}

interface Expected {
  requestedDifficulty: 'easy' | 'medium' | 'hard';
  aliases: string[]; // lowercased tokens that could indicate on-topic content
}

function score(actual: unknown, expected: Expected): EvalScore {
  const parsed = GeneratedQuestionSchema.safeParse(actual);
  if (!parsed.success) {
    return {
      case: 'question-generator',
      pass: false,
      score: 0,
      detail: `schema invalid: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
    };
  }
  const q = parsed.data;
  const problems: string[] = [];

  const kpInRange = q.keyPoints.length >= 2 && q.keyPoints.length <= 6;
  if (!kpInRange) problems.push(`keyPoints length ${q.keyPoints.length} not in [2, 6]`);

  const lenOk = q.prompt.length >= 40 && q.prompt.length <= 800;
  if (!lenOk) problems.push(`prompt length ${q.prompt.length} not in [40, 800]`);

  const diffOk = q.difficulty === expected.requestedDifficulty;
  if (!diffOk) problems.push(`difficulty '${q.difficulty}' does not match request '${expected.requestedDifficulty}'`);

  const haystack = `${q.prompt} ${q.answerHint ?? ''}`.toLowerCase();
  const onTopic = expected.aliases.some((a) => haystack.includes(a));
  if (!onTopic) problems.push(`no alias from [${expected.aliases.join(', ')}] found in prompt`);

  const combined = 0.4 + (kpInRange ? 0.15 : 0) + (lenOk ? 0.1 : 0) + (diffOk ? 0.15 : 0) + (onTopic ? 0.2 : 0);

  return {
    case: 'question-generator',
    pass: problems.length === 0,
    score: combined,
    detail: problems.length === 0 ? 'valid + on-topic + correct difficulty' : problems.join('; '),
  };
}

// 8 combos across 6 skills and all three difficulty bands.
export const QuestionGeneratorEval: EvalSuite<Input, Expected> = {
  name: 'question-generator',
  promptId: 'question-generator',
  promptVersion: '1.0.0',
  cases: [
    { id: 'react-easy',        input: { skillId: 'react',      skillName: 'React',       difficulty: 'easy'   }, expected: { requestedDifficulty: 'easy',   aliases: ['react', 'jsx', 'component'] } },
    { id: 'react-hard',        input: { skillId: 'react',      skillName: 'React',       difficulty: 'hard'   }, expected: { requestedDifficulty: 'hard',   aliases: ['react', 'reconciler', 'hydration', 'suspense'] } },
    { id: 'ts-medium',         input: { skillId: 'typescript', skillName: 'TypeScript',  difficulty: 'medium' }, expected: { requestedDifficulty: 'medium', aliases: ['typescript', 'type', 'generic', 'infer'] } },
    { id: 'node-medium',       input: { skillId: 'nodejs',     skillName: 'Node.js',     difficulty: 'medium' }, expected: { requestedDifficulty: 'medium', aliases: ['node', 'event loop', 'async', 'stream'] } },
    { id: 'postgres-easy',     input: { skillId: 'sql',        skillName: 'PostgreSQL',  difficulty: 'easy'   }, expected: { requestedDifficulty: 'easy',   aliases: ['postgres', 'sql', 'index', 'table'] } },
    { id: 'postgres-hard',     input: { skillId: 'sql',        skillName: 'PostgreSQL',  difficulty: 'hard'   }, expected: { requestedDifficulty: 'hard',   aliases: ['postgres', 'index', 'vacuum', 'mvcc', 'lock'] } },
    { id: 'docker-easy',       input: { skillId: 'docker',     skillName: 'Docker',      difficulty: 'easy'   }, expected: { requestedDifficulty: 'easy',   aliases: ['docker', 'container', 'image', 'layer'] } },
    { id: 'kubernetes-medium', input: { skillId: 'kubernetes', skillName: 'Kubernetes',  difficulty: 'medium' }, expected: { requestedDifficulty: 'medium', aliases: ['kubernetes', 'pod', 'deployment', 'service'] } },
  ],
  score,
};
