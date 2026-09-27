import type { RawJob } from '../src/types';

/**
 * Deterministic RawJob fixtures for pipeline stage tests. Two full rows and
 * a factory for one-off variants. Dates are hard-coded so freshness math is
 * reproducible.
 */

export const REF_NOW = new Date('2026-09-27T12:00:00.000Z');

export const remotiveRaw: RawJob = {
  sourceId: '12345',
  sourceName: 'remotive',
  canonicalUrl: 'https://remotive.com/remote-jobs/software-dev/senior-backend-engineer-12345',
  title: 'Senior Backend Engineer',
  company: 'Acme Remote Co',
  location: 'Worldwide',
  remote: true,
  description:
    'We are hiring a senior backend engineer to build our distributed platform. Experience with Node.js, PostgreSQL, and Kubernetes required. Full-time, fully remote.',
  sourcePostedAt: new Date('2026-09-20T08:00:00.000Z'),
  fetchedAt: new Date('2026-09-27T12:00:00.000Z'),
  payload: { origin: 'remotive-api-v1', id: 12345 },
};

export const greenhouseRaw: RawJob = {
  sourceId: 'gh-job-abc-999',
  sourceName: 'greenhouse',
  canonicalUrl: 'https://boards.greenhouse.io/acme/jobs/999',
  title: 'Staff Software Engineer',
  company: 'Acme Inc',
  location: 'San Francisco, CA',
  remote: false,
  description:
    'Staff engineer role owning our payments platform. 8+ years experience. On-site preferred, hybrid considered.',
  sourcePostedAt: new Date('2026-09-25T10:00:00.000Z'),
  fetchedAt: new Date('2026-09-27T12:00:00.000Z'),
  payload: { origin: 'greenhouse-boards', internalId: 'abc-999' },
};

/**
 * Factory for spinning ad-hoc RawJobs in tests without repeating boilerplate.
 * Fields default to `remotiveRaw`; override any subset.
 */
export function makeRawJob(overrides: Partial<RawJob> = {}): RawJob {
  return { ...remotiveRaw, ...overrides };
}
