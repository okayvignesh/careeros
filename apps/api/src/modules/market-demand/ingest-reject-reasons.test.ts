// AGENTS §5: "Every job flows through one pipeline ... Every reject logs a
// reason." This asserts the invariant at the shared ingest-plan boundary that
// `JobsService.ingest` persists to `job_reject_log` — the P2 geo/market work
// must not weaken it. (The DB-backed assertion lives in
// jobs.ingest.integration.test.ts and is CI-gated.)
import { describe, expect, it } from 'vitest';
import { planIngest, type RawJob } from '@careeros/job-pipeline';

function raw(overrides: Partial<RawJob> = {}): RawJob {
  return {
    sourceId: 'src-1',
    sourceName: 'remotive',
    canonicalUrl: 'https://example.com/jobs/1',
    title: 'Senior Backend Engineer',
    company: 'Acme',
    location: 'Remote',
    remote: true,
    description: 'Build APIs with Node and Postgres.',
    sourcePostedAt: new Date('2026-09-20T00:00:00Z'),
    fetchedAt: new Date('2026-09-20T00:00:00Z'),
    payload: {},
    ...overrides,
  };
}

describe('ingest reject-reason invariant (AGENTS §5)', () => {
  it('every rejected row carries a non-empty reason code', () => {
    const plan = planIngest([
      raw({ sourceId: 'ok-1', canonicalUrl: 'https://example.com/jobs/ok-1' }),
      raw({ sourceId: 'bad-title', canonicalUrl: 'https://example.com/jobs/bad-1', title: '' }),
      raw({ sourceId: 'bad-company', canonicalUrl: 'https://example.com/jobs/bad-2', company: '' }),
    ]);
    expect(plan.rejected.length).toBeGreaterThan(0);
    for (const reject of plan.rejected) {
      expect(reject.reason.length).toBeGreaterThan(0);
      expect(reject.details.reasons.length).toBeGreaterThan(0);
      expect(reject.details.reasons).toContain(reject.reason);
      expect(reject.sourceId).toBeTruthy();
      expect(reject.sourceName).toBeTruthy();
    }
    // A rejected row never leaks into the normalized survivors.
    for (const survivor of plan.normalized) {
      expect(survivor.title.length).toBeGreaterThan(0);
    }
  });
});
