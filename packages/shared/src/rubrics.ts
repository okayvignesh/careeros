// Rubric definitions. Typed TS module (no YAML dep) — smaller footprint and
// no runtime parser needed. When a rubric's content changes, `rubricHash()`
// returns a new hex so scores stay bound to the version they were graded under.
//
// ponytail: single system-design rubric committed inline. `rubric_versions`
// table lands only when we edit rubrics in-app — for now the file's content
// hash is the version, and old attempts keep whatever hash was current at grade
// time (stored on `attempt.gradingJson.rubricVersion`). djb2 hash keeps this
// package free of node:crypto so it can run in any JS runtime.

export type RubricLevel = 1 | 2 | 3 | 4 | 5;

export interface RubricDimension {
  id: string;
  name: string;
  descriptors: Record<RubricLevel, string>;
}

export interface Rubric {
  id: string;
  name: string;
  dimensions: RubricDimension[];
}

export const SYSTEM_DESIGN_RUBRIC: Rubric = {
  id: 'system-design',
  name: 'System design',
  dimensions: [
    {
      id: 'scalability',
      name: 'Scalability',
      descriptors: {
        1: 'No scaling considerations; single-machine thinking.',
        2: 'Mentions scaling but no concrete mechanism.',
        3: 'Identifies one bottleneck and a plausible mitigation.',
        4: 'Layered scaling story with quantified capacity + read/write split.',
        5: 'Rigorous capacity model with fan-out, backpressure, and failure isolation.',
      },
    },
    {
      id: 'reliability',
      name: 'Reliability',
      descriptors: {
        1: 'No failure modes discussed.',
        2: 'Acknowledges failures but no strategy.',
        3: 'Names at least one failure mode with a mitigation.',
        4: 'Covers retries, timeouts, and a plausible consistency model.',
        5: 'End-to-end failure model incl. partial failures, idempotency, and recovery.',
      },
    },
    {
      id: 'cost',
      name: 'Cost',
      descriptors: {
        1: 'No cost consideration.',
        2: 'Vague statement about being expensive or cheap.',
        3: 'Identifies dominant cost driver.',
        4: 'Estimates cost with unit economics for one dimension.',
        5: 'Cost model with per-request estimates and levers to reduce it.',
      },
    },
    {
      id: 'tradeoffs',
      name: 'Trade-offs',
      descriptors: {
        1: 'One-sided advocacy; no alternatives.',
        2: 'Mentions alternatives without comparing.',
        3: 'Compares two options on one axis.',
        4: 'Multi-axis comparison with a defended choice.',
        5: 'Explicit trade-off matrix; choice justified by workload characteristics.',
      },
    },
    {
      id: 'clarity',
      name: 'Clarity',
      descriptors: {
        1: 'Disorganized; hard to follow.',
        2: 'Sections present but shallow.',
        3: 'Clear structure with adequate depth.',
        4: 'Well-structured with concrete examples.',
        5: 'Crisp exposition; a stranger could implement from the description.',
      },
    },
  ],
};

export function rubricHash(rubric: Rubric): string {
  const s = JSON.stringify(rubric);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function getRubric(id: string): Rubric | null {
  return id === SYSTEM_DESIGN_RUBRIC.id ? SYSTEM_DESIGN_RUBRIC : null;
}

// -------- rule-based fallback grader --------

/**
 * Heuristic scorer for when the LLM grader isn't available. For each dimension
 * we look for its keyword vocabulary in the design; density buckets the score
 * into a rubric level. Coarse and gameable, but survives no-provider so the
 * user still gets a graded attempt with evidence written.
 */
const DIMENSION_KEYWORDS: Record<string, string[]> = {
  scalability: ['scale', 'shard', 'partition', 'throughput', 'load', 'horizontal', 'replica', 'cache', 'queue'],
  reliability: ['retry', 'timeout', 'failure', 'idempoten', 'consisten', 'durab', 'quorum', 'recover', 'fallback'],
  cost: ['cost', 'budget', 'cheap', 'expensive', 'egress', 'storage', 'compute', 'monthly', 'per-request'],
  tradeoffs: ['trade', 'alternative', 'instead', 'versus', 'compared', 'chose', 'downside', 'benefit'],
  clarity: ['section', 'first', 'then', 'because', 'example', 'diagram', 'step'],
};

export interface RubricDimensionScore {
  dimensionId: string;
  score: RubricLevel;
  notes: string;
}

export interface RubricGrade {
  score: number; // overall, in [0..1]
  dimensions: RubricDimensionScore[];
  reasoning: string;
}

export function gradeAgainstRubric(design: string, rubric: Rubric): RubricGrade {
  const norm = design.toLowerCase();
  const totalTokens = Math.max(1, norm.split(/\s+/).length);
  const dimensions: RubricDimensionScore[] = rubric.dimensions.map((d) => {
    const words = DIMENSION_KEYWORDS[d.id] ?? [];
    const hits = words.reduce((acc, w) => acc + (norm.includes(w) ? 1 : 0), 0);
    const density = hits / Math.max(1, words.length);
    const level: RubricLevel =
      density >= 0.7 ? 5 : density >= 0.5 ? 4 : density >= 0.3 ? 3 : density >= 0.15 ? 2 : 1;
    return {
      dimensionId: d.id,
      score: level,
      notes: `Matched ${hits}/${words.length} dimension keywords in ${totalTokens} tokens.`,
    };
  });
  const overall = dimensions.reduce((acc, d) => acc + d.score, 0) / (dimensions.length * 5);
  return {
    score: overall,
    dimensions,
    reasoning: `Rule-based fallback: keyword density per dimension. Overall ${(overall * 100).toFixed(0)}%.`,
  };
}
