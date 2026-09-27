// Assert-based self-check for the eval scaffold. Uses a stub runner that returns a
// well-formed extraction so the scorer can be exercised without hitting a real LLM.
// Run: npx tsx packages/ai/src/evals.demo.ts
import assert from 'node:assert/strict';
import { SkillExtractEval, runEval, formatReport } from './evals';

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

label('perfect stub returns 3/3 passed, 100%', async () => {
  const report = await runEval(SkillExtractEval, async (_suite, input) => {
    // "Perfect" stub: emit every skill the input names, keyed by lowercase name.
    // The scorer maps common names → ESCO-lite IDs so this behaves like a great LLM.
    const words = (input as { resumeText: string }).resumeText.toLowerCase();
    const skills: Array<{ name: string }> = [];
    for (const word of [
      'react', 'next.js', 'typescript', 'node.js', 'aws', 'postgresql', 'docker',
      'python', 'django', 'kubernetes', 'terraform', 'go', 'golang', 'rust',
    ]) {
      if (words.includes(word)) skills.push({ name: word });
    }
    return { skills };
  });
  assert.equal(report.total, 3);
  assert.equal(report.passed, 3);
  assert(report.meanScore >= 0.99);
});

label('empty stub scores every case as 0% pass, 0 mean', async () => {
  const report = await runEval(SkillExtractEval, async () => ({ skills: [] }));
  assert.equal(report.passed, 0);
  assert.equal(report.meanScore, 0);
});

label('partial stub captures per-case detail', async () => {
  const report = await runEval(SkillExtractEval, async (_suite, input) => {
    const text = (input as { resumeText: string }).resumeText.toLowerCase();
    // Only ever emit react; other cases fail with a clean "missing" detail.
    return { skills: text.includes('react') ? [{ name: 'react' }] : [] };
  });
  assert(report.passed <= 1);
  const first = report.cases[0]!;
  if (first.case === 'ts-react-node') {
    assert(!first.pass);
    assert((first.detail ?? '').includes('missing'));
  }
});

label('formatReport produces a compact multi-line summary', async () => {
  const report = await runEval(SkillExtractEval, async () => ({ skills: [] }));
  const s = formatReport(report);
  assert(s.startsWith('skill-extract (resume-extract@1.0.0)'));
  assert(s.split('\n').length === 1 + report.cases.length);
});

setTimeout(() => {
  if (process.exitCode !== 1) console.log('\nall eval scaffold checks passed');
}, 50);
