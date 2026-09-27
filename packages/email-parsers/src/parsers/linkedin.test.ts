import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseEmail } from '../index';
import { parseLinkedin } from './linkedin';
import { loadFixtures } from './fixtures';

const DEFAULTS = {
  from: 'jobs-noreply@linkedin.com',
  subject: 'default',
  receivedAt: '2026-01-01T09:00:00.000Z',
};

const FIXTURE_DIR = join(__dirname, '..', '..', '__fixtures__', 'linkedin');

describe('linkedin parser — golden fixtures', () => {
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

describe('linkedin parser — behavior', () => {
  it('returns [] on empty html', () => {
    expect(parseLinkedin('', new Date())).toEqual([]);
  });

  it('returns [] on html with no linkedin job links', () => {
    expect(parseLinkedin('<html><body><a href="https://example.com">unrelated</a></body></html>', new Date())).toEqual([]);
  });

  it('dedupes when the same job appears in a title anchor + apply button', () => {
    const html = `
      <a href="https://www.linkedin.com/comm/jobs/view/9999/?trk=title">Software Engineer</a>
      <a href="https://www.linkedin.com/comm/jobs/view/9999/?trk=apply">Software Engineer</a>
    `;
    const jobs = parseLinkedin(html, new Date());
    expect(jobs.length).toBe(1);
  });

  it('does not throw on malformed html', () => {
    expect(() => parseLinkedin('<html><body><a href=', new Date())).not.toThrow();
  });
});
