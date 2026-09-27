import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseEmail } from '../index';
import { parseIndeed } from './indeed';
import { loadFixtures } from './fixtures';

const DEFAULTS = {
  from: 'alert@indeed.com',
  subject: 'default',
  receivedAt: '2026-01-01T09:00:00.000Z',
};

const FIXTURE_DIR = join(__dirname, '..', '..', '__fixtures__', 'indeed');

describe('indeed parser — golden fixtures', () => {
  const cases = loadFixtures(FIXTURE_DIR, DEFAULTS);

  it('loads at least 10 fixtures', () => {
    expect(cases.length).toBeGreaterThanOrEqual(10);
  });

  for (const c of cases) {
    it(`${c.name} matches expected`, () => {
      const actual = parseEmail({
        from: c.meta.from,
        subject: c.meta.subject,
        html: c.html,
        receivedAt: new Date(c.meta.receivedAt),
      });
      expect(actual).toEqual(c.expected);
    });
  }
});

describe('indeed parser — behavior', () => {
  it('returns [] on empty html', () => {
    expect(parseIndeed('', new Date())).toEqual([]);
  });

  it('dedupes by jk key when the same job appears in multiple anchors', () => {
    const html = `
      <a href="https://www.indeed.com/rc/clk?jk=abc123&trk=title">Backend Engineer</a>
      <a href="https://www.indeed.com/rc/clk?jk=abc123&trk=apply">Backend Engineer</a>
    `;
    expect(parseIndeed(html, new Date()).length).toBe(1);
  });

  it('does not throw on malformed html', () => {
    expect(() => parseIndeed('<a href="https://www.indeed.com/', new Date())).not.toThrow();
  });
});
