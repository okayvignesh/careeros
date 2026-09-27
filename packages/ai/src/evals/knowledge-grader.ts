// Seed eval suite for the knowledge-grader prompt. Score bands:
//   perfect answer  → expected 0.9..1.0
//   partial answer  → expected 0.4..0.7
//   empty answer    → expected 0.0..0.1
//   wrong answer    → expected 0.0..0.3
//
// The scorer passes when the model's returned score lands inside the expected
// band. Bands are wider than a single number because grading is inherently
// noisy and we don't want CI to flap on 0.02 drift.
import type { EvalScore, EvalSuite } from './types';

interface Input {
  question: string;
  keyPoints: string[];
  answer: string;
}

interface Expected {
  scoreMin: number;
  scoreMax: number;
  requiredHits?: string[]; // hits[] must include all of these (case-insensitive substring)
  requiredMisses?: string[]; // misses[] must include all of these
}

interface Actual {
  score?: number;
  hits?: string[];
  misses?: string[];
}

function includesCI(list: string[], needle: string): boolean {
  const n = needle.toLowerCase();
  return list.some((s) => s.toLowerCase().includes(n));
}

function score(actual: unknown, expected: Expected): EvalScore {
  const a = (actual ?? {}) as Actual;
  const s = typeof a.score === 'number' ? a.score : -1;
  const inBand = s >= expected.scoreMin && s <= expected.scoreMax;
  const hits = a.hits ?? [];
  const misses = a.misses ?? [];
  const hitProblems = (expected.requiredHits ?? []).filter((h) => !includesCI(hits, h));
  const missProblems = (expected.requiredMisses ?? []).filter((m) => !includesCI(misses, m));

  const bandScore = inBand ? 1 : 0;
  const hitScore =
    (expected.requiredHits ?? []).length === 0
      ? 1
      : ((expected.requiredHits!.length - hitProblems.length) / expected.requiredHits!.length);
  const missScore =
    (expected.requiredMisses ?? []).length === 0
      ? 1
      : ((expected.requiredMisses!.length - missProblems.length) / expected.requiredMisses!.length);
  const combined = bandScore * 0.6 + hitScore * 0.2 + missScore * 0.2;

  const problems: string[] = [];
  if (!inBand) problems.push(`score ${s.toFixed(2)} outside [${expected.scoreMin}, ${expected.scoreMax}]`);
  if (hitProblems.length) problems.push(`missing hits: ${hitProblems.join(', ')}`);
  if (missProblems.length) problems.push(`missing misses: ${missProblems.join(', ')}`);

  return {
    case: 'knowledge-grader',
    pass: problems.length === 0,
    score: combined,
    detail: problems.length === 0 ? `score ${s.toFixed(2)} in band` : problems.join('; '),
  };
}

// ponytail: 6 fixtures across 2 questions (React + Postgres) covering the four
// score bands. Grows to 20+ as more questions land and we mine attempts for
// disagreements. Kept in this file (not JSON) so type errors catch schema drift.
export const KnowledgeGraderEval: EvalSuite<Input, Expected> = {
  name: 'knowledge-grader',
  promptId: 'knowledge-grader',
  promptVersion: '1.0.0',
  cases: [
    {
      id: 'react-perfect',
      input: {
        question:
          'Explain how React decides which DOM nodes to update between two renders. Mention at least the diffing strategy and any data structure it relies on.',
        keyPoints: ['virtual DOM', 'reconciler', 'keys'],
        answer:
          'React builds a virtual DOM tree each render and diffs it against the previous one using the reconciler. For lists it relies on `key` props to match nodes across renders instead of comparing by index.',
      },
      expected: {
        scoreMin: 0.9,
        scoreMax: 1.0,
        requiredHits: ['virtual DOM', 'reconciler', 'key'],
      },
    },
    {
      id: 'react-partial',
      input: {
        question:
          'Explain how React decides which DOM nodes to update between two renders. Mention at least the diffing strategy and any data structure it relies on.',
        keyPoints: ['virtual DOM', 'reconciler', 'keys'],
        answer:
          'React uses a virtual DOM to figure out what changed and then updates only the affected nodes.',
      },
      expected: {
        scoreMin: 0.3,
        scoreMax: 0.7,
        requiredHits: ['virtual DOM'],
        requiredMisses: ['key'],
      },
    },
    {
      id: 'react-empty',
      input: {
        question:
          'Explain how React decides which DOM nodes to update between two renders. Mention at least the diffing strategy and any data structure it relies on.',
        keyPoints: ['virtual DOM', 'reconciler', 'keys'],
        answer: 'I do not know.',
      },
      expected: {
        scoreMin: 0.0,
        scoreMax: 0.1,
        requiredMisses: ['virtual DOM', 'reconciler', 'key'],
      },
    },
    {
      id: 'react-wrong',
      input: {
        question:
          'Explain how React decides which DOM nodes to update between two renders. Mention at least the diffing strategy and any data structure it relies on.',
        keyPoints: ['virtual DOM', 'reconciler', 'keys'],
        answer:
          'React re-renders the entire DOM on every state change and lets the browser figure out the diff.',
      },
      expected: {
        scoreMin: 0.0,
        scoreMax: 0.3,
      },
    },
    {
      id: 'postgres-perfect',
      input: {
        question:
          'Describe when a partial index outperforms a plain B-tree index. Give one query shape that would benefit.',
        keyPoints: ['partial index', 'WHERE', 'selective'],
        answer:
          'A partial index only indexes rows matching a WHERE predicate, so it stays small and selective when most rows are irrelevant. Example: `CREATE INDEX ON orders (created_at) WHERE status = \'open\'` for queries filtered to open orders.',
      },
      expected: {
        scoreMin: 0.85,
        scoreMax: 1.0,
        requiredHits: ['partial index', 'WHERE'],
      },
    },
    {
      id: 'postgres-partial',
      input: {
        question:
          'Describe when a partial index outperforms a plain B-tree index. Give one query shape that would benefit.',
        keyPoints: ['partial index', 'WHERE', 'selective'],
        answer:
          'Partial indexes are useful when only a small subset of rows are ever queried.',
      },
      expected: {
        scoreMin: 0.3,
        scoreMax: 0.7,
        requiredHits: ['partial index'],
      },
    },
  ],
  score,
};
