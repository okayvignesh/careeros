// Eval runner. Iterates suites, invokes a caller-supplied `run` (usually a
// provider.chatStructured wrap that renders the suite's prompt), scores each case,
// and returns an EvalReport per suite. Runner is offline-safe: pass a stub `run`
// for CI so a bad connection or missing key doesn't turn into flaky red.
import type { EvalReport, EvalSuite } from './types';

export type CaseRunner<Input> = (suite: EvalSuite<Input, unknown>, input: Input) => Promise<unknown>;

export async function runEval<Input, Expected>(
  suite: EvalSuite<Input, Expected>,
  runner: CaseRunner<Input>,
): Promise<EvalReport> {
  const cases: EvalReport['cases'] = [];
  for (const c of suite.cases) {
    const actual = await runner(suite as EvalSuite<Input, unknown>, c.input);
    const s = suite.score(actual, c.expected);
    cases.push({ ...s, case: c.id });
  }
  const passed = cases.filter((c) => c.pass).length;
  const meanScore = cases.length === 0 ? 0 : cases.reduce((a, b) => a + b.score, 0) / cases.length;
  return {
    suite: suite.name,
    promptId: suite.promptId,
    promptVersion: suite.promptVersion,
    total: cases.length,
    passed,
    meanScore,
    cases,
  };
}

export function formatReport(r: EvalReport): string {
  const pct = (r.meanScore * 100).toFixed(1);
  const header = `${r.suite} (${r.promptId}@${r.promptVersion}): ${r.passed}/${r.total} passed, mean ${pct}%`;
  const lines = r.cases.map(
    (c) => `  ${c.pass ? 'ok' : 'FAIL'} ${c.case} (${(c.score * 100).toFixed(0)}%) ${c.detail ?? ''}`,
  );
  return [header, ...lines].join('\n');
}
