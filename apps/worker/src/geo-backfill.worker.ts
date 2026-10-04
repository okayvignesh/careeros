/**
 * P1 `jobs.geo-backfill` consumer (job-targeting §5).
 *
 * Backfills structured geography + sponsorship onto legacy `jobs_normalized`
 * rows that pre-date the ingest-time parse. One row per job with the stable id
 * `geo-backfill:<jobId>` (see `jobsGeoBackfillJobId`) so re-enqueueing the same
 * row collapses to a single job. The handler is idempotent: it re-derives the
 * same columns from `location` + `description` every run and stamps
 * `geoParsedAt` when done.
 */
import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import { parseLocation, sponsorshipSignal, type SponsorshipEvidence } from '@careeros/job-pipeline';
import {
  JOB_JOBS_GEO_BACKFILL,
  QUEUE_JOBS_GEO_BACKFILL,
  jobsGeoBackfillJobId,
  type JobsGeoBackfillPayload,
} from '@careeros/shared';

export { QUEUE_JOBS_GEO_BACKFILL, JOB_JOBS_GEO_BACKFILL, jobsGeoBackfillJobId };
export type { JobsGeoBackfillPayload };

export type WorkerLogger = Pick<Logger, 'info' | 'warn' | 'error'>;

export interface GeoBackfillJobRow {
  id: string;
  location: string | null;
  description: string;
  workplaceType: string | null;
}

export interface GeoBackfillRepo {
  normalizedJob: {
    findUnique(args: {
      where: { id: string };
      select: {
        id: true;
        location: true;
        description: true;
        workplaceType: true;
      };
    }): Promise<GeoBackfillJobRow | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
}

export interface GeoBackfillResult {
  jobId: string;
  parsed: boolean;
  country: string | null;
  sponsorshipSignal: string;
}

/** Structural BullMQ `Queue` slice so producers/tests avoid the bullmq dep. */
export interface GeoBackfillQueue {
  add(
    name: string,
    data: object,
    opts: {
      jobId: string;
      removeOnComplete?: { count: number };
      removeOnFail?: { count: number };
    },
  ): Promise<unknown>;
}

/** Enqueue one row's backfill with the idempotent stable job id. */
export async function enqueueGeoBackfill(
  queue: GeoBackfillQueue,
  jobId: string,
): Promise<void> {
  await queue.add(
    JOB_JOBS_GEO_BACKFILL,
    { jobId } satisfies JobsGeoBackfillPayload,
    {
      jobId: jobsGeoBackfillJobId(jobId),
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 30 },
    },
  );
}

export async function handleJobsGeoBackfill(
  prisma: PrismaClient,
  logger: WorkerLogger,
  payload: JobsGeoBackfillPayload,
  now: () => Date = () => new Date(),
): Promise<GeoBackfillResult> {
  const repo = prisma as unknown as GeoBackfillRepo;
  const job = await repo.normalizedJob.findUnique({
    where: { id: payload.jobId },
    select: { id: true, location: true, description: true, workplaceType: true },
  });
  if (!job) {
    logger.warn({ jobId: payload.jobId }, 'geo-backfill: job not found; skipping');
    return { jobId: payload.jobId, parsed: false, country: null, sponsorshipSignal: 'unclear' };
  }

  const parsed = now();
  const geo = parseLocation(job.location);
  const sponsorship = sponsorshipSignal(job.description);
  const evidence: SponsorshipEvidence | undefined =
    sponsorship.value === 'unclear'
      ? undefined
      : {
          value: sponsorship.value,
          matched: sponsorship.matched,
          source: 'description',
          confidence: sponsorship.confidence,
          parsedAt: parsed.toISOString(),
        };

  const data: Record<string, unknown> = {
    country: geo.country ?? null,
    region: geo.region ?? null,
    city: geo.city ?? null,
    workplaceType: job.workplaceType ?? geo.workplaceType ?? null,
    remoteScope: geo.remoteScope ?? null,
    sponsorshipSignal: sponsorship.value,
    geoParsedAt: parsed,
  };
  if (evidence) data.sponsorshipEvidence = evidence;

  await repo.normalizedJob.update({ where: { id: job.id }, data });
  logger.info(
    { jobId: job.id, country: geo.country ?? null, sponsorship: sponsorship.value },
    'geo-backfill: parsed',
  );
  return {
    jobId: job.id,
    parsed: true,
    country: geo.country ?? null,
    sponsorshipSignal: sponsorship.value,
  };
}
