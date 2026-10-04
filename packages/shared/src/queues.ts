// Shared queue definitions so api (producer) and worker (consumer) agree on names + payloads.
// Add new job types here; every producer/consumer imports from this module only.

export const QUEUE_GITHUB = 'github';

export type GithubJobName = 'sync';

export interface GithubSyncPayload {
  userId: string;
  reason: 'setup' | 'manual' | 'scheduled';
}

export const QUEUE_GITLAB = 'gitlab';

export type GitlabJobName = 'sync';

export interface GitlabSyncPayload {
  userId: string;
  reason: 'setup' | 'manual' | 'scheduled';
}

export const QUEUE_EMBEDDING = 'embedding';

export type EmbeddingJobName = 'generate';

/**
 * Embedding job. One job per source-item; the worker chunks internally.
 * `collection` matches a CollectionDef.name from collections.ts.
 * `sourceKind` scopes payload shape (e.g. 'resume_fact' → payload includes fact.kind).
 * `sensitivity` is set by the enqueue site so the gate is honoured at write time.
 */
export interface EmbeddingGeneratePayload {
  userId: string;
  collection: string;
  sourceId: string;
  sourceKind: 'resume_fact' | 'code_file' | 'repo_doc' | 'other';
  text: string;
  sensitivity: 'public' | 'personal' | 'confidential' | 'employer-confidential';
  meta?: Record<string, string | number | boolean>;
}

// F8: scheduled candidate-targeted Firecrawl search. The handler iterates
// every candidate with career goals when `userId` is omitted; a manual run may
// scope to one user.
export const QUEUE_FIRECRAWL_SEARCH = 'firecrawl-search';

export const JOB_FIRECRAWL_SEARCH = 'search';

export type FirecrawlSearchJobName = typeof JOB_FIRECRAWL_SEARCH;

export interface FirecrawlSearchPayload {
  reason: 'scheduled' | 'manual';
  /** Omit for the scheduled all-candidates sweep. */
  userId?: string;
}

// P1 job-targeting: backfill structured geo (`country/region/city/workplace/
// remoteScope/sponsorshipSignal`) onto legacy `jobs_normalized` rows. One job
// per row with a stable id so a re-enqueue is idempotent and `geoParsedAt`
// marks completion.
export const QUEUE_JOBS_GEO_BACKFILL = 'jobs.geo-backfill';

export const JOB_JOBS_GEO_BACKFILL = 'backfill';

export type JobsGeoBackfillJobName = typeof JOB_JOBS_GEO_BACKFILL;

export interface JobsGeoBackfillPayload {
  /** NormalizedJob.id to (re)parse. */
  jobId: string;
}

/** Stable BullMQ job id — enqueueing the same row twice collapses to one job. */
export function jobsGeoBackfillJobId(jobId: string): string {
  return `geo-backfill:${jobId}`;
}
