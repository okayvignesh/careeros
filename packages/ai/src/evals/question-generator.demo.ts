// Assert-based self-check for the question-generator eval scorer. Uses stubs
// that shape plausible outputs so the scorer's branches all get exercised.
import assert from 'node:assert/strict';
import { QuestionGeneratorEval } from './question-generator';
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

label('perfect stub: valid schema, on-topic, right difficulty for every case', async () => {
  const report = await runEval(QuestionGeneratorEval, async (_suite, input) => ({
    prompt:
      `Explain a key concept in ${input.skillName} that matters at ${input.difficulty} level. ` +
      `Focus on how ${input.skillName.toLowerCase()} handles common cases and one edge case.`,
    keyPoints: [`${input.skillName.toLowerCase()} core concept`, 'a common case', 'an edge case'],
    answerHint: 'Think about the mechanism, then the trade-off.',
    difficulty: input.difficulty,
  }));
  assert.equal(report.total, 8);
  assert.equal(report.passed, 8);
  assert(report.meanScore >= 0.99);
});

label('schema-invalid stub gets 0 and does not crash', async () => {
  const report = await runEval(QuestionGeneratorEval, async () => ({
    prompt: 'short',
    keyPoints: [],
    difficulty: 'medium',
  }));
  assert.equal(report.passed, 0);
  assert.equal(report.meanScore, 0);
});

label('wrong-topic stub: schema-valid but no alias match, difficulty mismatch', async () => {
  const report = await runEval(QuestionGeneratorEval, async () => ({
    prompt:
      'Discuss the historical evolution of medieval cathedral architecture and its influence on modern urban planning across three continents.',
    keyPoints: ['gothic revival', 'flying buttress', 'nave'],
    answerHint: 'Think stone.',
    difficulty: 'medium', // hard-coded; several cases request easy/hard
  }));
  // Schema is valid so 0.4 base; some cases match difficulty (0.15) but none match aliases.
  assert(report.passed === 0);
  assert(report.meanScore > 0.4 && report.meanScore < 0.8);
});

label('formatReport shape: header + one line per case', async () => {
  const report = await runEval(QuestionGeneratorEval, async () => ({
    prompt: 'x'.repeat(50),
    keyPoints: ['a', 'b'],
    answerHint: null,
    difficulty: 'medium',
  }));
  const s = formatReport(report);
  assert(s.startsWith('question-generator (question-generator@1.0.0)'));
  assert.equal(s.split('\n').length, 1 + report.cases.length);
});

setTimeout(() => {
  if (process.exitCode !== 1) console.log('\nall question-generator eval checks passed');
}, 50);
