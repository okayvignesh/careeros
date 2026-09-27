// Types for the LLM eval suite. An eval is a table of (input, expected) rows and a
// scoring function that turns model output into a pass/fail + score in [0, 1].
//
// Runners are prompt-registry-aware: every eval knows the prompt id + version it's
// evaluating so a `pnpm eval:ai` run can print which prompt/version failed and by how much.

export interface EvalCase<Input, Expected> {
  id: string;
  input: Input;
  expected: Expected;
}

export interface EvalScore {
  case: string;
  pass: boolean;
  score: number; // [0, 1]
  detail?: string;
}

export interface EvalSuite<Input, Expected> {
  name: string;
  promptId: string;
  promptVersion: string;
  cases: EvalCase<Input, Expected>[];
  score(actual: unknown, expected: Expected): EvalScore;
}

export interface EvalReport {
  suite: string;
  promptId: string;
  promptVersion: string;
  total: number;
  passed: number;
  meanScore: number;
  cases: EvalScore[];
}
