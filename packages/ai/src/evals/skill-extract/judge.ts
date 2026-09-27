// C-P1.4a: F1 judge for skill-extract evals.
//
// Judge formula:
//   P = |predicted ∩ expected| / |predicted|
//   R = |predicted ∩ expected| / |expected|
//   F1 = 2*P*R / (P+R)     (0 if P+R == 0)
//
// Tie-breakers / edge cases:
//   - empty expected  + empty predicted   → pass, F1 = 1 (nothing to find, nothing found)
//   - empty expected  + non-empty pred    → pass, F1 = 1 but noted (over-generation on a
//     "no skills" fixture is not a hard fail; the ID gate in jobs.service drops unknowns)
//   - non-empty exp   + empty predicted   → fail, F1 = 0
//   - IDs are lower-cased + trimmed before compare so 'AWS' == 'aws'.
//
// Pass gate: F1 >= 0.75. Drift note added when F1 in [0.75, 0.9).

export interface JudgeInput {
  skillIds: string[];
}

export interface Expected {
  skills: string[];
}

export interface JudgeResult {
  pass: boolean;
  f1: number;
  precision: number;
  recall: number;
  tp: string[];
  fp: string[];
  fn: string[];
  notes: string | null;
}

const PASS_F1 = 0.75;
const DRIFT_F1 = 0.9;

function norm(ids: string[] | undefined): Set<string> {
  const out = new Set<string>();
  for (const id of ids ?? []) {
    const s = (id ?? '').toLowerCase().trim();
    if (s) out.add(s);
  }
  return out;
}

export function judgeSkillExtract(output: JudgeInput, expected: Expected): JudgeResult {
  const pred = norm(output?.skillIds);
  const exp = norm(expected.skills);

  const tp: string[] = [];
  const fp: string[] = [];
  const fn: string[] = [];
  for (const id of pred) (exp.has(id) ? tp : fp).push(id);
  for (const id of exp) if (!pred.has(id)) fn.push(id);

  // Empty-expected + empty-pred: perfect. Empty-expected + any pred: still pass,
  // but flag so the surrounding prompt or catalogue can be tightened later.
  if (exp.size === 0) {
    return {
      pass: true,
      f1: pred.size === 0 ? 1 : 1,
      precision: pred.size === 0 ? 1 : 0,
      recall: 1,
      tp: [],
      fp,
      fn: [],
      notes: pred.size === 0 ? null : `over-generated on no-skill fixture: ${fp.join(', ')}`,
    };
  }

  const precision = pred.size === 0 ? 0 : tp.length / pred.size;
  const recall = tp.length / exp.size;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  let notes: string | null = null;
  if (f1 < PASS_F1) {
    notes = `F1=${f1.toFixed(2)} < ${PASS_F1}; missing=[${fn.join(',')}] spurious=[${fp.join(',')}]`;
  } else if (f1 < DRIFT_F1) {
    notes = `drift: F1=${f1.toFixed(2)} < ${DRIFT_F1}; missing=[${fn.join(',')}] spurious=[${fp.join(',')}]`;
  }

  return {
    pass: f1 >= PASS_F1,
    f1,
    precision,
    recall,
    tp,
    fp,
    fn,
    notes,
  };
}

export const SKILL_EXTRACT_JUDGE_PASS_F1 = PASS_F1;
export const SKILL_EXTRACT_JUDGE_DRIFT_F1 = DRIFT_F1;
