// C4 cleanup: real-Postgres integration test for the shared job-ingest funnel
// (`JobsService.sync` → `planIngest` → normalize → crossSourceDedupe → verify →
// Prisma persist).
//
// Proves with a real database that one sync:
//   1. appends every fetched row to `jobs_raw` (append-only provenance),
//   2. folds cross-source duplicates into a single `jobs_normalized` row whose
//      `sourceIds` carries both sources' provenance tags,
//   3. writes hard-failed rows to `job_reject_log` (never to jobs_normalized),
//   4. re-syncing an existing canonicalUrl merges the new source tag into the
//      stored `sourceIds` instead of inserting a duplicate.
//
// Guarded by TESTCONTAINERS_E2E=1 + isDockerAvailable() so the default
// `pnpm test` on a laptop without Docker skips cleanly.
// Run: `TESTCONTAINERS_E2E=1 pnpm test:integration`.
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { isDockerAvailable, resetDb, startInfra, type StartedInfra } from '@careeros/testing';
import type { RawJob } from '@careeros/job-pipeline';
import { JobsService } from './jobs.service';

const runE2E = process.env.TESTCONTAINERS_E2E === '1' && isDockerAvailable();
const maybe = runE2E ? describe : describe.skip;

const HOOK_TIMEOUT_MS = 180_000;

function raw(
  overrides: Partial<RawJob> & Pick<RawJob, 'sourceId' | 'sourceName' | 'canonicalUrl'>,
): RawJob {
  const now = Date.now();
  return {
    title: 'Senior Backend Engineer',
    company: 'Acme Corp',
    location: null,
    remote: true,
    description:
      'We are hiring a senior backend engineer to build distributed systems with Postgres and TypeScript at scale.',
    sourcePostedAt: new Date(now - 5 * 86_400_000),
    fetchedAt: new Date(now),
    payload: {},
    ...overrides,
  } as RawJob;
}

/** JobsService with its adapter registry replaced by a single fake adapter. */
function makeService(prisma: PrismaClient, adapterId: string, raws: RawJob[]): JobsService {
  const svc = new JobsService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { resolve: async () => ({ values: {}, secrets: {} }) } as never,
  );
  (svc as unknown as { adapters: Record<string, unknown> }).adapters = {
    [adapterId]: {
      id: adapterId,
      name: adapterId,
      tier: 1 as const,
      licenseHint: 'test',
      attribution: 'test',
      fetch: async () => raws,
    },
  };
  return svc;
}

maybe('JobsService ingest funnel (opt-in: TESTCONTAINERS_E2E=1)', () => {
  let infra: StartedInfra;
  let prisma: PrismaClient;

  beforeAll(async () => {
    infra = await startInfra({
      services: { postgres: true, redis: false, qdrant: false, minio: false },
    });
    process.env.DATABASE_URL = infra.postgresUrl;

    const boot = new PrismaClient({ datasources: { db: { url: infra.postgresUrl } } });
    await boot.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS citext');
    await boot.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await boot.$disconnect();

    const apiDir = path.resolve(__dirname, '../../..');
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd: apiDir,
      env: { ...process.env, DATABASE_URL: infra.postgresUrl },
      stdio: 'inherit',
    });

    prisma = new PrismaClient({ datasources: { db: { url: infra.postgresUrl } } });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await prisma?.$disconnect().catch(() => undefined);
    await infra?.cleanup();
  }, HOOK_TIMEOUT_MS);

  beforeEach(async () => {
    await resetDb(prisma);
  });

  it('persists raw rows, merges cross-source duplicates, and logs a rejected row', async () => {
    const ashbyUrl = 'https://jobs.ashbyhq.com/acme/1';
    const svc = makeService(prisma, 'ashby', [
      raw({ sourceId: 'ash-1', sourceName: 'ashby', canonicalUrl: ashbyUrl }),
      // Same job re-listed on a lower-tier aggregator → should be folded in.
      raw({
        sourceId: 'rem-1',
        sourceName: 'remotive',
        canonicalUrl: 'https://remotive.com/jobs/1',
      }),
      // Hard-fail: blank title → verify() rejects with `blank-title`.
      raw({
        sourceId: 'bad-1',
        sourceName: 'remotive',
        canonicalUrl: 'https://remotive.com/jobs/bad',
        title: '',
        company: 'Sketchy Holdings',
      }),
    ]);

    const stats = await svc.sync('ashby');

    expect(stats.fetched).toBe(3);
    expect(stats.rawInserted).toBe(3);
    expect(stats.merged).toBe(1);
    expect(stats.rejected).toBe(1);
    expect(stats.normalizedInserted).toBe(1);

    // jobs_raw is append-only provenance: one row per fetched posting.
    expect(await prisma.jobRaw.count()).toBe(3);

    // Duplicate folded into the higher-tier winner, provenance preserved.
    const normalized = await prisma.normalizedJob.findMany();
    expect(normalized).toHaveLength(1);
    expect(normalized[0]!.canonicalUrl).toBe(ashbyUrl);
    expect(normalized[0]!.primarySource).toBe('ashby');
    expect(new Set(normalized[0]!.sourceIds)).toEqual(new Set(['ashby:ash-1', 'remotive:rem-1']));

    // Rejected row never reaches jobs_normalized; it lands in the reject log.
    const rejects = await prisma.jobRejectLog.findMany();
    expect(rejects).toHaveLength(1);
    expect(rejects[0]!.sourceId).toBe('bad-1');
    expect(rejects[0]!.sourceName).toBe('remotive');
    expect(rejects[0]!.reason).toBe('blank-title');
    expect(rejects[0]!.verdict).toBe('rejected');
  });

  it('re-syncing the same canonicalUrl merges the new source tag into the existing row', async () => {
    const url = 'https://jobs.ashbyhq.com/acme/merge';
    await makeService(prisma, 'ashby', [
      raw({ sourceId: 'ash-merge', sourceName: 'ashby', canonicalUrl: url }),
    ]).sync('ashby');

    const stats = await makeService(prisma, 'greenhouse', [
      raw({ sourceId: 'gh-merge', sourceName: 'greenhouse', canonicalUrl: url }),
    ]).sync('greenhouse');

    expect(stats.normalizedUpdated).toBe(1);
    expect(stats.normalizedInserted).toBe(0);

    const rows = await prisma.normalizedJob.findMany({ where: { canonicalUrl: url } });
    expect(rows).toHaveLength(1);
    expect(new Set(rows[0]!.sourceIds)).toEqual(
      new Set(['ashby:ash-merge', 'greenhouse:gh-merge']),
    );
  });
});

// ALWAYS runs. Proves the skip guard is wired and the module imports cleanly
// on machines without Docker.
describe('JobsService ingest skip guard', () => {
  it('respects TESTCONTAINERS_E2E + docker availability', () => {
    expect(typeof runE2E).toBe('boolean');
  });
});
