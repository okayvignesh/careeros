// Runnable self-check for rubrics. Assert-based, no framework.
// Run: pnpm --filter @careeros/shared exec node --loader tsx src/rubrics.demo.ts
import assert from 'node:assert/strict';
import {
  SYSTEM_DESIGN_RUBRIC,
  gradeAgainstRubric,
  getRubric,
  rubricHash,
} from './rubrics';

function label(name: string, fn: () => void) {
  fn();
  // eslint-disable-next-line no-console
  console.log(`ok ${name}`);
}

label('rubric hash is deterministic and 8 hex chars', () => {
  const h1 = rubricHash(SYSTEM_DESIGN_RUBRIC);
  const h2 = rubricHash(SYSTEM_DESIGN_RUBRIC);
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{8}$/);
});

label('rubric hash changes when a descriptor changes', () => {
  const h1 = rubricHash(SYSTEM_DESIGN_RUBRIC);
  const mutated = {
    ...SYSTEM_DESIGN_RUBRIC,
    dimensions: [
      { ...SYSTEM_DESIGN_RUBRIC.dimensions[0]!, descriptors: { ...SYSTEM_DESIGN_RUBRIC.dimensions[0]!.descriptors, 3: 'edited' } },
      ...SYSTEM_DESIGN_RUBRIC.dimensions.slice(1),
    ],
  };
  assert.notEqual(h1, rubricHash(mutated));
});

label('getRubric returns SYSTEM_DESIGN_RUBRIC for known id, null for unknown', () => {
  assert.equal(getRubric('system-design')?.id, 'system-design');
  assert.equal(getRubric('nonsense'), null);
});

label('gradeAgainstRubric: empty design scores near the floor', () => {
  const r = gradeAgainstRubric('', SYSTEM_DESIGN_RUBRIC);
  assert(r.score < 0.3);
  assert.equal(r.dimensions.length, SYSTEM_DESIGN_RUBRIC.dimensions.length);
});

label('gradeAgainstRubric: keyword-heavy design lifts scalability + reliability', () => {
  const design = `
    We shard the primary write path by tenant. Each shard has a replica for read scale.
    Requests go through a queue for backpressure; retries are idempotent with a client
    request id. Timeouts cascade; a failure in one shard does not affect others.
    Recovery uses durable event log; consistency is per-tenant serializable.
  `;
  const r = gradeAgainstRubric(design, SYSTEM_DESIGN_RUBRIC);
  const scalability = r.dimensions.find((d) => d.dimensionId === 'scalability')!;
  const reliability = r.dimensions.find((d) => d.dimensionId === 'reliability')!;
  assert(scalability.score >= 3);
  assert(reliability.score >= 3);
});

label('gradeAgainstRubric: overall score is mean/5 in [0,1]', () => {
  const design = 'shard partition retry timeout cost tradeoff first then example';
  const r = gradeAgainstRubric(design, SYSTEM_DESIGN_RUBRIC);
  assert(r.score >= 0 && r.score <= 1);
  const meanLevel = r.dimensions.reduce((a, d) => a + d.score, 0) / r.dimensions.length;
  assert(Math.abs(r.score - meanLevel / 5) < 1e-9);
});

// eslint-disable-next-line no-console
console.log('\nall rubric checks passed');
