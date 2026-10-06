// P1 one-off: enqueue `jobs.geo-backfill` for every `jobs_normalized` row that
// pre-dates the ingest-time geo parse (`geoParsedAt IS NULL`). Idempotent — the
// stable `geo-backfill:<jobId>` id means re-running collapses duplicate jobs.
//
// Run from the repo root:
//   pnpm --filter @careeros/api exec ts-node --project tsconfig.json --transpile-only ../../scripts/jobs-geo-backfill.ts
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { QUEUE_JOBS_GEO_BACKFILL } from '@careeros/shared';
import { enqueueGeoBackfill } from '../apps/worker/src/geo-backfill.worker';

const BATCH = 5_000;

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const queue = new Queue(QUEUE_JOBS_GEO_BACKFILL, {
    connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6379' },
  });

  let total = 0;
  for (;;) {
    const rows = await prisma.normalizedJob.findMany({
      where: { geoParsedAt: null },
      select: { id: true },
      take: BATCH,
    });
    if (rows.length === 0) break;
    for (const row of rows) await enqueueGeoBackfill(queue, row.id);
    total += rows.length;
    if (rows.length < BATCH) break;
    // Rows only leave the unparsed set once the worker runs; stop after one
    // pass per batch to avoid spinning on the same set.
    break;
  }

  process.stdout.write(`enqueued ${total} geo-backfill job(s)\n`);
  await queue.close();
  await prisma.$disconnect();
}

main().catch((err) => {
  process.stderr.write(`geo-backfill enqueue failed: ${(err as Error).message}\n`);
  process.exit(1);
});
