// Self-check for hallucination detector + generateGrounded.
// Run: pnpm exec tsx packages/ai/src/grounded.demo.ts (via any workspace with tsx)
import assert from 'node:assert/strict';
import { z } from 'zod';
import { findHallucinations } from './hallucination';
import { generateGrounded, type GroundedFact } from './grounded';
import { register } from './prompts/registry';

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

// ---------- findHallucinations ----------

label('numbers in output that appear in facts are NOT flagged', () => {
  const facts = ['Managed a team of 12 engineers over 3 years'];
  const output = { summary: 'Led 12 engineers for 3 years' };
  const r = findHallucinations(output, facts);
  assert.equal(r.suspects.length, 0);
});

label('a fabricated number is flagged', () => {
  const facts = ['Managed a team of 12 engineers'];
  const output = { summary: 'Led 47 engineers on a $2M budget' };
  const r = findHallucinations(output, facts);
  assert(r.suspects.includes('47'));
  assert(r.suspects.some((s) => s.includes('$2M') || s.includes('2M')));
});

label('a fabricated date is flagged', () => {
  const facts = ['Joined in January 2020, left December 2023'];
  const output = { role: 'Started 2015-06-01, ended 2024' };
  const r = findHallucinations(output, facts);
  assert(r.byKind.dates.some((d) => d.includes('2015-06-01')));
  assert(r.suspects.includes('2024'));
});

label('a fabricated proper-noun run is flagged', () => {
  const facts = ['Worked at Acme Corp on the shipping product'];
  const output = { company: 'Worked at Globex Industries on shipping' };
  const r = findHallucinations(output, facts);
  assert(r.byKind.properNouns.some((p) => p.includes('Globex Industries')));
  assert(r.suspects.some((s) => s.includes('Globex')));
});

label('proper-noun run present in facts is NOT flagged', () => {
  const facts = ['Wrote Kubernetes operators for internal Acme Corp platform'];
  const output = { skills: ['Kubernetes', 'Acme Corp platform'] };
  const r = findHallucinations(output, facts);
  assert(!r.suspects.some((s) => s.includes('Acme Corp')));
});

label('detector walks nested arrays and objects', () => {
  const facts = ['Reduced latency to 200ms'];
  const output = {
    metrics: [
      { name: 'latency', value: '200ms' },
      { name: 'throughput', value: '99.9%' },
    ],
  };
  const r = findHallucinations(output, facts);
  assert(r.suspects.some((s) => s.includes('99.9')));
  assert(!r.suspects.includes('200'));
});

// ---------- generateGrounded (with a stub provider) ----------

const StubSchema = z.object({ answer: z.string(), evidenceRefs: z.array(z.string()) });

register({
  id: 'stub-grounded',
  version: '1.0.0',
  system: 'Answer briefly from the wrapped facts. Return JSON.',
  userTemplate: 'Question: {{question}}\n\nFacts:\n{{facts}}',
  schema: StubSchema,
});

async function runGrounded() {
  const facts: GroundedFact[] = [
    { id: 'emp-1', content: 'Acme Corp, Senior Engineer, 2019-2022', sourceKind: 'resume' },
    { id: 'emp-2', content: 'Globex, Staff Engineer, 2022-present', sourceKind: 'resume' },
  ];

  // Faithful stub: echoes fact content verbatim.
  const faithful = {
    chatStructured: async () => ({
      answer: 'Acme Corp, then Globex from 2022-present.',
      evidenceRefs: ['emp-1', 'emp-2'],
    }),
  };
  const r1 = await generateGrounded({
    provider: faithful,
    promptId: 'stub-grounded',
    facts,
    vars: { question: 'Where did they work?' },
  });
  assert.equal(r1.hallucinations.suspects.length, 0);
  assert.equal(r1.prompt.id, 'stub-grounded');
  assert.equal(r1.prompt.version, '1.0.0');

  // Fabricating stub: invents a multi-word company + year (the heuristic requires
  // at least two capitalised words in a row to flag a proper noun).
  const fabricating = {
    chatStructured: async () => ({
      answer: 'Acme Corp until 2018, then Initech Systems from 2019 to 2024.',
      evidenceRefs: ['emp-1'],
    }),
  };
  let hookFired = false;
  let capturedSuspects: string[] = [];
  const r2 = await generateGrounded({
    provider: fabricating,
    promptId: 'stub-grounded',
    facts,
    vars: { question: 'Where did they work?' },
    onHallucination: (report) => {
      hookFired = true;
      capturedSuspects = report.suspects;
    },
  });
  assert(r2.hallucinations.suspects.length > 0);
  assert(r2.hallucinations.suspects.some((s) => s.includes('Initech Systems')));
  assert(r2.hallucinations.suspects.includes('2018'));
  // Give the fire-and-forget microtask a tick to run.
  await new Promise((res) => setTimeout(res, 5));
  assert.equal(hookFired, true);
  assert(capturedSuspects.length > 0);
}

label('generateGrounded wraps facts and detects fabrication', () => runGrounded());

setTimeout(() => {
  if (process.exitCode !== 1) {
    console.log('\nall grounded + hallucination checks passed');
  }
}, 50);
