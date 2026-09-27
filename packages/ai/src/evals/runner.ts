// Eval runner. Iterates suites, invokes a caller-supplied `run` (usually a
// provider.chatStructured wrap that renders the suite's prompt), scores each case,
// and returns an EvalReport per suite. Runner is offline-safe: pass a stub `run`
// for CI so a bad connection or missing key doesn't turn into flaky red.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
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

// C-P1.4a: JUnit + JSON emitters so the nightly-evals workflow (C-P0.5) can
// upload eval-results/junit.xml as a CI artifact and drift.json for the
// pass-rate regression check. Hand-rolled, no eval-framework dep.
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function toJunitXml(reports: EvalReport[]): string {
  const totals = reports.reduce(
    (a, r) => ({ tests: a.tests + r.total, failures: a.failures + (r.total - r.passed) }),
    { tests: 0, failures: 0 },
  );
  const suites = reports
    .map((r) => {
      const failures = r.total - r.passed;
      const cases = r.cases
        .map((c) => {
          const name = escapeXml(c.case);
          const cls = escapeXml(`${r.suite}.${r.promptId}@${r.promptVersion}`);
          if (c.pass) return `    <testcase name="${name}" classname="${cls}"/>`;
          const detail = escapeXml(c.detail ?? `score=${c.score}`);
          return [
            `    <testcase name="${name}" classname="${cls}">`,
            `      <failure message="${detail}">score=${c.score}</failure>`,
            `    </testcase>`,
          ].join('\n');
        })
        .join('\n');
      return [
        `  <testsuite name="${escapeXml(r.suite)}" tests="${r.total}" failures="${failures}">`,
        cases,
        `  </testsuite>`,
      ].join('\n');
    })
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="careeros-evals" tests="${totals.tests}" failures="${totals.failures}">`,
    suites,
    '</testsuites>',
    '',
  ].join('\n');
}

export interface JsonSummary {
  generatedAt: string;
  reports: EvalReport[];
  overall: { total: number; passed: number; meanScore: number };
}

export function toJsonSummary(reports: EvalReport[]): JsonSummary {
  const total = reports.reduce((a, r) => a + r.total, 0);
  const passed = reports.reduce((a, r) => a + r.passed, 0);
  const meanScore =
    total === 0
      ? 0
      : reports.reduce((a, r) => a + r.meanScore * r.total, 0) / total;
  return {
    generatedAt: new Date().toISOString(),
    reports,
    overall: { total, passed, meanScore },
  };
}

export function writeEvalArtifacts(reports: EvalReport[], outDir: string): void {
  mkdirSync(dirname(`${outDir}/junit.xml`), { recursive: true });
  writeFileSync(`${outDir}/junit.xml`, toJunitXml(reports));
  writeFileSync(`${outDir}/summary.json`, JSON.stringify(toJsonSummary(reports), null, 2));
}
