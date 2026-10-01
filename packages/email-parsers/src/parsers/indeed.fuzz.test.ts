// testing.md side-car: fuzz for email parsers (P5).
// See linkedin.fuzz.test.ts for the shared rationale.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseIndeed } from './indeed';
import { parseEmail, EmailJobSchema, ParsedEmailSchema } from '../index';

const RUNS = 500;

const htmlNoise = fc.oneof(
  fc.string({ maxLength: 4_000 }),
  fc.webUrl().map((u) => `<a href="${u}">x</a>`),
  fc.stringMatching(/^(<a href=["']?[^<>]{0,80}["']?>[^<]{0,120}<\/a>){1,8}$/),
  fc.array(
    fc.record({
      href: fc.oneof(
        fc.string({ maxLength: 40 }).map((s) => `https://www.indeed.com/rc/clk?jk=${encodeURIComponent(s)}`),
        fc.string({ maxLength: 40 }).map((s) => `https://indeed.com/viewjob?jk=${encodeURIComponent(s)}`),
        fc.string({ maxLength: 40 }).map((s) => `https://indeed.com/pagead/clk?jk=${encodeURIComponent(s)}`),
        fc.webUrl(),
      ),
      text: fc.string({ maxLength: 200 }),
    }),
    { maxLength: 10 },
  ).map((rows) => rows.map((r) => `<a href="${r.href}">${r.text}</a>`).join('\n')),
);

const senderNoise = fc.oneof(
  fc.constant('alert@indeed.com'),
  fc.constant('noreply@indeed.com'),
  fc.string({ maxLength: 120 }),
  fc.emailAddress(),
);

describe('indeed parser — fuzz', () => {
  it(`does not throw across ${RUNS} garbled HTML inputs`, () => {
    fc.assert(
      fc.property(htmlNoise, fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }), (html, receivedAt) => {
        const jobs = parseIndeed(html, receivedAt);
        for (const j of jobs) EmailJobSchema.parse(j);
      }),
      { numRuns: RUNS },
    );
  });

  it(`parseEmail entry point: never throws, always returns ParsedEmail or null`, () => {
    fc.assert(
      fc.property(senderNoise, fc.string({ maxLength: 500 }), htmlNoise, (from, subject, html) => {
        const out = parseEmail({ from, subject, html });
        if (out === null) return;
        ParsedEmailSchema.parse(out);
      }),
      { numRuns: RUNS },
    );
  });

  it('empty + whitespace-only inputs are stable', () => {
    for (const html of ['', ' ', '\n\n', '<', '<a', '<a href=']) {
      expect(() => parseIndeed(html, new Date())).not.toThrow();
      expect(parseIndeed(html, new Date())).toEqual([]);
    }
  });
});
