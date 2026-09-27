import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseEmail } from '../index';
import { parseNaukri } from './naukri';
import { loadFixtures } from './fixtures';

const DEFAULTS = {
  from: 'mailer@naukri.com',
  subject: 'default',
  receivedAt: '2026-01-01T09:00:00.000Z',
};

const FIXTURE_DIR = join(__dirname, '..', '..', '__fixtures__', 'naukri');

describe('naukri parser — golden fixtures', () => {
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

describe('naukri parser — behavior', () => {
  it('returns [] on empty html', () => {
    expect(parseNaukri('', new Date())).toEqual([]);
  });

  it('unwraps nma.naukri.com redirect wrappers', () => {
    const wrapped = encodeURIComponent('https://www.naukri.com/job-listings-senior-engineer-acme-bengaluru-3-6-years-abc123');
    const html = `<a href="https://nma.naukri.com/dem/mail?url=${wrapped}">Senior Engineer</a><div>Acme | Bengaluru</div>`;
    const jobs = parseNaukri(html, new Date());
    expect(jobs.length).toBe(1);
    expect(jobs[0]?.url).toContain('naukri.com/job-listings-senior-engineer-acme-bengaluru');
  });

  it('does not throw on malformed html', () => {
    expect(() => parseNaukri('<a href="https://naukri.com/', new Date())).not.toThrow();
  });
});
