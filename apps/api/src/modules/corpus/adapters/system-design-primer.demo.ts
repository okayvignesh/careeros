// Runnable self-check for the system-design-primer parser.
// Run: pnpm --filter @careeros/api exec tsx src/modules/corpus/adapters/system-design-primer.demo.ts
import assert from 'node:assert/strict';
import { parseSystemDesignPrimer } from './system-design-primer';

function label(name: string, fn: () => void) {
  fn();
  // eslint-disable-next-line no-console
  console.log(`ok ${name}`);
}

const FIXTURE = `
# System Design Primer

Some intro prose that ends with a question? This should NOT be picked up because it isn't a bullet.

## Practice questions

- [Design a URL shortener like TinyURL](path/to/exercise)
- [Design a **web crawler** with distributed workers](path/to/exercise)
- Design a chat application with 1-1 and group messaging?
- Not a question, just a statement about caching
- *
- [Design Amazon's sales rank by category feature](exercise.md)?
- What are the trade-offs between eventual and strong consistency?
- Design a global content delivery network. How would you handle regional failover?
- Q: too short?

## Non-question section

Some paragraph text. Even ends with question mark? Not a bullet, ignored.
`;

label('extracts only bullet lines that end with `?`', () => {
  const qs = parseSystemDesignPrimer(FIXTURE);
  // Expected picks: "Design a chat application with 1-1 and group messaging?",
  //                 "Design Amazon's sales rank by category feature?",
  //                 "What are the trade-offs between eventual and strong consistency?",
  //                 "Design a global content delivery network. How would you handle regional failover?"
  assert(qs.length >= 3, `expected ≥3 questions, got ${qs.length}`);
  for (const q of qs) assert(q.prompt.endsWith('?'), `not a question: ${q.prompt}`);
});

label('strips markdown link decoration', () => {
  const qs = parseSystemDesignPrimer('- [Design a **chat** app for group messaging](x)?\n');
  assert.equal(qs.length, 1);
  assert.equal(qs[0]!.prompt, 'Design a chat app for group messaging?');
});

label('assigns `system-design` skill by default', () => {
  const qs = parseSystemDesignPrimer('- Design a rate limiter for a shared API?\n');
  assert.deepEqual(qs[0]!.skillIds, ['system-design']);
});

label('dedupes case-insensitively', () => {
  const qs = parseSystemDesignPrimer(
    '- Design a URL shortener like TinyURL?\n- design a URL shortener like TinyURL?\n',
  );
  assert.equal(qs.length, 1);
});

label('skips bullets that are neither questions nor starter-led', () => {
  const qs = parseSystemDesignPrimer(
    '- Reference: HN thread on distributed caching strategies.\n' +
      '- Related: see the section above on load balancing.\n',
  );
  assert.equal(qs.length, 0);
});

label('skips prose paragraphs that end with `?`', () => {
  const qs = parseSystemDesignPrimer('This is a prose sentence that ends with a question?\n');
  assert.equal(qs.length, 0);
});

label('skips too-short questions (heuristic filter)', () => {
  const qs = parseSystemDesignPrimer('- Q: too short?\n');
  assert.equal(qs.length, 0);
});

label('picks up link-form bullets that start with a question starter word', () => {
  const qs = parseSystemDesignPrimer(
    '- [Design a URL shortener like TinyURL](solution/exercise)\n' +
      '- [Design Amazons sales rank by category feature](exercise.md)\n' +
      '- [How would you design a rate limiter](exercise.md)\n',
  );
  assert.equal(qs.length, 3);
  for (const q of qs) assert(q.prompt.endsWith('?'), `not normalised: ${q.prompt}`);
});

label('does not match bullets that are neither questions nor starter-led', () => {
  const qs = parseSystemDesignPrimer(
    '- [Solutions folder for practice problems](solution/)\n' +
      '- The primer covers scaling, caching, and load balancing.\n',
  );
  assert.equal(qs.length, 0);
});

label('returns [] on empty input rather than throwing', () => {
  const qs = parseSystemDesignPrimer('');
  assert.equal(qs.length, 0);
});

// eslint-disable-next-line no-console
console.log('\nall system-design-primer parser checks passed');
