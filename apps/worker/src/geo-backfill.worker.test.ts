import { describe, expect, it, vi } from 'vitest';
import { jobsGeoBackfillJobId } from '@careeros/shared';
import {
  enqueueGeoBackfill,
  handleJobsGeoBackfill,
  type GeoBackfillRepo,
} from './geo-backfill.worker';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function makeRepo(
  job: { id: string; location: string | null; description: string; workplaceType: string | null } | null,
) {
  const updates: Array<Record<string, unknown>> = [];
  // Re-parsing metadata must never touch the append-only raw log.
  const jobRawWrites = vi.fn(async () => ({}));
  const repo = {
    normalizedJob: {
      findUnique: vi.fn(async () => job),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        return {};
      }),
    },
    jobRaw: {
      create: jobRawWrites,
      createMany: jobRawWrites,
      update: jobRawWrites,
      updateMany: jobRawWrites,
    },
  };
  return { repo: repo as unknown as GeoBackfillRepo, updates, jobRawWrites };
}

describe('handleJobsGeoBackfill', () => {
  it('re-derives geo + sponsorship, stamps geoParsedAt, and leaves jobs_raw untouched', async () => {
    const { repo, updates, jobRawWrites } = makeRepo({
      id: 'job-1',
      location: 'London, UK',
      description: 'We are able to provide visa sponsorship for this role.',
      workplaceType: null,
    });
    const fixed = new Date('2026-06-01T00:00:00.000Z');

    const result = await handleJobsGeoBackfill(repo as never, logger, { jobId: 'job-1' }, () => fixed);

    expect(result).toMatchObject({ jobId: 'job-1', parsed: true, country: 'GB', sponsorshipSignal: 'likely' });
    expect(jobRawWrites).not.toHaveBeenCalled();
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ country: 'GB', city: 'london', sponsorshipSignal: 'likely' });
    expect(updates[0]!.geoParsedAt).toEqual(fixed);
    expect(updates[0]!.sponsorshipEvidence).toMatchObject({ value: 'likely', source: 'description' });
  });

  it('never fabricates a country for an ambiguous city', async () => {
    const { repo, updates } = makeRepo({
      id: 'job-2',
      location: 'London',
      description: 'A detailed description that mentions nothing about visa eligibility.',
      workplaceType: null,
    });
    await handleJobsGeoBackfill(repo as never, logger, { jobId: 'job-2' });
    expect(updates[0]).toMatchObject({ country: null, city: 'london', sponsorshipSignal: 'unclear' });
    expect(updates[0]!.sponsorshipEvidence).toBeUndefined();
  });

  it('is idempotent — the same input yields the same columns', async () => {
    const job = {
      id: 'job-3',
      location: 'Bengaluru, India',
      description: 'No visa sponsorship available.',
      workplaceType: 'onsite' as string | null,
    };
    const fixed = new Date('2026-06-01T00:00:00.000Z');
    const a = makeRepo(job);
    const b = makeRepo(job);
    await handleJobsGeoBackfill(a.repo as never, logger, { jobId: 'job-3' }, () => fixed);
    await handleJobsGeoBackfill(b.repo as never, logger, { jobId: 'job-3' }, () => fixed);
    expect(a.updates[0]).toEqual(b.updates[0]);
    expect(a.updates[0]).toMatchObject({ country: 'IN', sponsorshipSignal: 'none' });
  });

  it('skips cleanly when the job row is gone', async () => {
    const { repo, updates } = makeRepo(null);
    const result = await handleJobsGeoBackfill(repo as never, logger, { jobId: 'missing' });
    expect(result.parsed).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it('preserves an existing employer-declared workplaceType', async () => {
    const { repo, updates } = makeRepo({
      id: 'job-4',
      location: null,
      description: 'A detailed description that mentions nothing about visa eligibility.',
      workplaceType: 'hybrid',
    });
    await handleJobsGeoBackfill(repo as never, logger, { jobId: 'job-4' });
    expect(updates[0]).toMatchObject({ workplaceType: 'hybrid' });
  });
});

describe('enqueueGeoBackfill', () => {
  it('uses the stable idempotent jobId', async () => {
    const add = vi.fn(async () => ({}));
    await enqueueGeoBackfill({ add }, 'job-9');
    expect(add).toHaveBeenCalledWith(
      'backfill',
      { jobId: 'job-9' },
      expect.objectContaining({ jobId: jobsGeoBackfillJobId('job-9') }),
    );
    expect(jobsGeoBackfillJobId('job-9')).toBe('geo-backfill:job-9');
  });
});
