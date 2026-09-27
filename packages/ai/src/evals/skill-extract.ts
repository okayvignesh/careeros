// Seed eval suite for the resume-extract prompt. Scores by fraction of expected
// ESCO-lite skill IDs that appear in the model's `skills[]` output.
//
// TODO(slice 7b+): grow to 20+ cases (blueprint target) with a mix of clean and
// noisy resumes. Today's three fixtures are the smallest set that catches "prompt
// no longer extracts skills at all" regressions.
import type { EvalScore, EvalSuite } from './types';

interface Input {
  resumeText: string;
}

interface Expected {
  requiredSkills: string[]; // ESCO-lite ids from apps/worker/src/skills-seed.ts
  optionalSkills?: string[]; // partial credit
}

interface Actual {
  skills?: Array<{ name?: string }>;
}

const SKILL_NAME_TO_ID: Record<string, string> = {
  javascript: 'js',
  typescript: 'ts',
  react: 'react',
  nextjs: 'nextjs',
  'next.js': 'nextjs',
  nodejs: 'nodejs',
  'node.js': 'nodejs',
  node: 'nodejs',
  python: 'python',
  django: 'django',
  fastapi: 'fastapi',
  docker: 'docker',
  kubernetes: 'kubernetes',
  k8s: 'kubernetes',
  postgresql: 'sql',
  postgres: 'sql',
  sql: 'sql',
  aws: 'aws',
  gcp: 'gcp',
  go: 'go',
  golang: 'go',
  rust: 'rust',
  terraform: 'terraform',
};

// Hoist the ID set once so the extractor doesn't rebuild it per skill in a hot loop.
const VALID_SKILL_IDS: ReadonlySet<string> = new Set(Object.values(SKILL_NAME_TO_ID));

function extractSkillIds(actual: unknown): Set<string> {
  const a = (actual ?? {}) as Actual;
  const ids = new Set<string>();
  for (const s of a.skills ?? []) {
    const name = (s?.name ?? '').toLowerCase().trim();
    if (name in SKILL_NAME_TO_ID) ids.add(SKILL_NAME_TO_ID[name]!);
    // Also match on the raw ID so a model that emits 'react' passes directly.
    if (name && VALID_SKILL_IDS.has(name)) ids.add(name);
  }
  return ids;
}

function score(actual: unknown, expected: Expected): EvalScore {
  const got = extractSkillIds(actual);
  const required = expected.requiredSkills;
  const optional = expected.optionalSkills ?? [];
  const missing = required.filter((id) => !got.has(id));
  const bonus = optional.filter((id) => got.has(id)).length;
  const requiredScore = required.length === 0 ? 1 : (required.length - missing.length) / required.length;
  const bonusScore = optional.length === 0 ? 0 : (bonus / optional.length) * 0.1; // capped 10% bonus
  const finalScore = Math.min(1, requiredScore + bonusScore);
  return {
    case: 'skill-extract',
    pass: missing.length === 0,
    score: finalScore,
    detail:
      missing.length === 0
        ? `all ${required.length} required skills found; ${bonus} optional bonus`
        : `missing: ${missing.join(', ')}`,
  };
}

export const SkillExtractEval: EvalSuite<Input, Expected> = {
  name: 'skill-extract',
  promptId: 'resume-extract',
  promptVersion: '1.0.0',
  cases: [
    {
      id: 'ts-react-node',
      input: {
        resumeText: [
          'Full-stack engineer',
          'Built customer dashboards in React and Next.js with TypeScript.',
          'Shipped Node.js backends on AWS with PostgreSQL.',
          'Comfortable with Docker for local dev.',
        ].join('\n'),
      },
      expected: {
        requiredSkills: ['ts', 'react', 'nextjs', 'nodejs', 'aws', 'sql'],
        optionalSkills: ['docker'],
      },
    },
    {
      id: 'python-django',
      input: {
        resumeText: [
          'Backend engineer.',
          'Wrote Django REST APIs in Python.',
          'Deployed on Kubernetes with Terraform-managed AWS infra.',
        ].join('\n'),
      },
      expected: {
        requiredSkills: ['python', 'django', 'kubernetes', 'terraform', 'aws'],
      },
    },
    {
      id: 'go-postgres',
      input: {
        resumeText: [
          'Systems engineer.',
          'Golang microservices backed by PostgreSQL.',
          'Migrating some services to Rust for perf-critical paths.',
        ].join('\n'),
      },
      expected: {
        requiredSkills: ['go', 'sql', 'rust'],
      },
    },
  ],
  score,
};
