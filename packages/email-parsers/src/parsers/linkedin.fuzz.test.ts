// testing.md side-car: fuzz for email parsers (P5).
//
// Garbled subject/body/sender inputs must not crash parseLinkedin or
// parseEmail; whatever comes back must satisfy the Zod schemas (or be a
// clean null from the entry point).
//
// ponytail: 500 iters per parser is the agreed ceiling; raise if a real
// bug slips through. Shrinking is on by default in fast-check.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseLinkedin } from './linkedin';
import { parseEmail, EmailJobSchema, ParsedEmailSchema } from '../index';

const RUNS = 500;

const htmlNoise = fc.oneof(
  fc.string({ maxLength: 4_000 }),
  fc.webUrl().map((u) => `<a href="${u}">x</a>`),
  // Deliberately malformed tags, unterminated attrs, mixed quotes.
  fc.stringMatching(/^(<a href=["']?[^<>]{0,80}["']?>[^<]{0,120}<\/a>){1,8}$/),
  // Half-valid LinkedIn-ish anchors so the parser's real path gets exercised.
  fc.array(
    fc.record({
      href: fc.oneof(
        fc.constant('https://www.linkedin.com/comm/jobs/view/'),
        fc.string({ maxLength: 60 }).map((s) => `https://www.linkedin.com/comm/jobs/view/${encodeURIComponent(s)}`),
        fc.string({ maxLength: 60 }).map((s) => `https://linkedin.com/jobs/view/${encodeURIComponent(s)}`),
        fc.webUrl(),
      ),
      text: fc.string({ maxLength: 200 }),
    }),
    { maxLength: 10 },
  ).map((rows) => rows.map((r) => `<a href="${r.href}">${r.text}</a>`).join('\n')),
);

const senderNoise = fc.oneof(
  fc.constant('jobs-noreply@linkedin.com'),
  fc.constant('jobs@linkedin.com'),
  fc.string({ maxLength: 120 }),
  fc.emailAddress(),
);

const subjectNoise = fc.string({ maxLength: 500 });

describe('linkedin parser — fuzz', () => {
  it(`does not throw across ${RUNS} garbled HTML inputs`, () => {
    fc.assert(
      fc.property(htmlNoise, fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }), (html, receivedAt) => {
        const jobs = parseLinkedin(html, receivedAt);
        // Every job returned must conform to the public schema; parsers must
        // not emit half-populated or wrong-typed shapes under any input.
        for (const j of jobs) EmailJobSchema.parse(j);
      }),
      { numRuns: RUNS },
    );
  });

  it(`parseEmail entry point: never throws, always returns ParsedEmail or null`, () => {
    fc.assert(
      fc.property(senderNoise, subjectNoise, htmlNoise, (from, subject, html) => {
        const out = parseEmail({ from, subject, html });
        if (out === null) return;
        ParsedEmailSchema.parse(out);
      }),
      { numRuns: RUNS },
    );
  });

  it('empty + whitespace-only inputs are stable', () => {
    for (const html of ['', ' ', '\n\n', '<', '<a', '<a href=']) {
      expect(() => parseLinkedin(html, new Date())).not.toThrow();
      expect(parseLinkedin(html, new Date())).toEqual([]);
    }
  });
});
