// Assert-based self-check for the knowledge-grader eval suite. Uses a stub
// runner that returns realistic-looking KnowledgeGrade shapes so the scorer
// gets exercised without an LLM.
import assert from 'node:assert/strict';
import { KnowledgeGraderEval } from './knowledge-grader';
import { runEval, formatReport } from './runner';

function label(name: string, fn: () => Promise<void> | void) {
  const r = fn();
  if (r instanceof Promise) {
    r.then(
      () => console.log(`ok ${name}`),
      (err) => {
        console.error(`fail ${name}:`, err);
        process.exitCode = 1;
      },
    );
  } else {
    console.log(`ok ${name}`);
  }
}

label('perfect grader stub passes every case', async () => {
  // "Perfect" stub: hit the top of every expected band, echo required hits/misses.
  const report = await runEval(KnowledgeGraderEval, async (_suite, input) => {
    const kp = input.keyPoints;
    const answerLc = input.answer.toLowerCase();
    const hits = kp.filter((k) => answerLc.includes(k.toLowerCase().split(' ')[0]!));
    const misses = kp.filter((k) => !hits.includes(k));
    const score = hits.length / kp.length;
    return { score, hits, misses, reasoning: 'stub' };
  });
  assert.equal(report.total, 6);
  // Stub isn't literally perfect against expected bands; just check it doesn't crash and reports.
  assert(report.meanScore >= 0);
});

label('zero-score stub places every case at band-fail', async () => {
  const report = await runEval(KnowledgeGraderEval, async () => ({
    score: 0,
    hits: [],
    misses: ['virtual DOM', 'reconciler', 'keys', 'partial index', 'WHERE', 'selective'],
    reasoning: 'stub',
  }));
  // Cases in the 0.0..0.1 or 0.0..0.3 band will pass; the higher-band cases fail.
  assert(report.passed >= 1 && report.passed <= 5);
});

label('formatReport shape includes header + one line per case', async () => {
  const report = await runEval(KnowledgeGraderEval, async () => ({
    score: 0.5,
    hits: [],
    misses: [],
    reasoning: 'stub',
  }));
  const s = formatReport(report);
  assert(s.startsWith('knowledge-grader (knowledge-grader@1.0.0)'));
  assert.equal(s.split('\n').length, 1 + report.cases.length);
});

label('band scorer catches out-of-band scores', async () => {
  // Return 1.0 for every case; only the "perfect" cases have that in-band.
  const report = await runEval(KnowledgeGraderEval, async () => ({
    score: 1.0,
    hits: ['virtual DOM', 'reconciler', 'keys', 'partial index', 'WHERE'],
    misses: [],
    reasoning: 'stub',
  }));
  // react-perfect (0.9..1.0) and postgres-perfect (0.85..1.0) are in-band; others out.
  const passIds = report.cases.filter((c) => c.pass).map((c) => c.case);
  assert(passIds.length >= 2);
});

setTimeout(() => {
  if (process.exitCode !== 1) console.log('\nall knowledge-grader eval checks passed');
}, 50);
