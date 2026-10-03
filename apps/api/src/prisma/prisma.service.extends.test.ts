// C-P1.5d — verify the $use -> $extends migration preserved everything the
// old middleware did: (1) encryption on write for ENCRYPTED_FIELDS,
// (2) decryption on Prisma model read, (3) metrics counter increments on any
// query.
//
// Docker-gated (TESTCONTAINERS_E2E=1) because Prisma extensions can only be
// exercised end-to-end against a real database; the extension callback
// receives a bound `query` function that the mock world cannot fabricate
// without re-implementing half of the Prisma engine.
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { isDockerAvailable, startInfra, type StartedInfra } from '@careeros/testing';
import { MetricsService } from '../common/metrics/metrics.service';
import { PrismaService } from './prisma.service';

const runE2E = process.env.TESTCONTAINERS_E2E === '1' && isDockerAvailable();
const maybe = runE2E ? describe : describe.skip;

const HOOK_TIMEOUT_MS = 180_000;
const PLAINTEXT = 'extends-test snippet with digits 12345';

maybe('PrismaService $extends (opt-in: TESTCONTAINERS_E2E=1)', () => {
  let infra: StartedInfra;
  let raw: PrismaClient;
  let metrics: MetricsService;
  let svc: PrismaService;
  let userId: string;

  beforeAll(async () => {
    infra = await startInfra({ services: { postgres: true, redis: false, qdrant: false, minio: false } });
    process.env.DATABASE_URL = infra.postgresUrl;

    // See sibling encrypted-fields-opacity.integration.test.ts for the
    // db-push-not-migrate-deploy rationale.
    raw = new PrismaClient({ datasources: { db: { url: infra.postgresUrl } } });
    await raw.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS citext');
    await raw.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pgcrypto');

    const apiDir = path.resolve(__dirname, '../..');
    execFileSync('pnpm', ['exec', 'prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
      cwd: apiDir,
      env: { ...process.env, DATABASE_URL: infra.postgresUrl },
      stdio: 'inherit',
    });

    metrics = new MetricsService();
    svc = new PrismaService(metrics);
    await svc.onModuleInit();

    const user = await raw.user.create({
      data: {
        email: `extends-${Date.now()}@test.local`,
        passwordHash: 'x'.repeat(60),
      },
    });
    userId = user.id;
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await svc?.onModuleDestroy().catch(() => undefined);
    await raw?.$disconnect().catch(() => undefined);
    await infra?.cleanup();
  }, HOOK_TIMEOUT_MS);

  it('encrypts LlmHallucinationLog.snippet on write (raw column is ciphertext)', async () => {
    const created = await svc.llmHallucinationLog.create({
      data: {
        userId,
        promptId: 'extends.test',
        promptVersion: '1',
        promptHash: 'ext-hash',
        snippet: PLAINTEXT,
      },
    });

    const rows = await raw.$queryRaw<Array<{ snippet: string | null }>>`
      SELECT "snippet" FROM "llm_hallucination_log" WHERE "id" = ${created.id}::uuid
    `;
    expect(rows[0]?.snippet?.startsWith('enc:v1:snippet:')).toBe(true);
    expect(rows[0]?.snippet).not.toContain(PLAINTEXT);
  });

  it('decrypts LlmHallucinationLog.snippet on Prisma model read', async () => {
    const [row] = await svc.llmHallucinationLog.findMany({
      where: { userId, promptId: 'extends.test' },
      take: 1,
    });
    expect(row?.snippet).toBe(PLAINTEXT);
  });

  it('increments careeros_prisma_queries_total on any query', async () => {
    // Capture a baseline for the specific label set we know we just used.
    const before = await metrics.renderJson();
    const findRowValue = (labels: Record<string, string>): number => {
      const dump = before as Array<{ name: string; values: Array<{ labels: Record<string, string>; value: number }> }>;
      const counter = dump.find((m) => m.name === 'careeros_prisma_queries_total');
      const row = counter?.values.find((v) =>
        Object.entries(labels).every(([k, val]) => v.labels[k] === val),
      );
      return row?.value ?? 0;
    };
    const baselineFindMany = findRowValue({ model: 'LlmHallucinationLog', op: 'findMany', ok: 'true' });

    // Any query — pick something cheap that touches an ENCRYPTED_FIELDS model.
    await svc.llmHallucinationLog.findMany({ where: { userId }, take: 1 });

    interface MetricSample {
      labels: Record<string, string>;
      value: number;
      metricName?: string;
    }
    const after = (await metrics.renderJson()) as Array<{ name: string; values: MetricSample[] }>;
    const counter = after.find((m) => m.name === 'careeros_prisma_queries_total');
    const row = counter?.values.find(
      (v) =>
        v.labels.model === 'LlmHallucinationLog' &&
        v.labels.op === 'findMany' &&
        v.labels.ok === 'true',
    );
    expect(row?.value ?? 0).toBeGreaterThan(baselineFindMany);

    // Histogram sanity: a `_count` sample exists for the same label set.
    const hist = after.find((m) => m.name === 'careeros_prisma_query_duration_seconds');
    const histCount = hist?.values.find(
      (v) =>
        v.labels.model === 'LlmHallucinationLog' &&
        v.labels.op === 'findMany' &&
        v.metricName?.endsWith('_count'),
    );
    expect((histCount?.value ?? 0) > 0).toBe(true);
  });
});

// Always-runs skip guard — proves the module imports cleanly on machines
// without Docker; a broken guard would silently pass an empty file.
describe('prisma.service.extends skip guard', () => {
  it('respects TESTCONTAINERS_E2E env + docker availability', () => {
    expect(typeof runE2E).toBe('boolean');
  });
});

// Always runs: the rotation service depends on `rawClient` bypassing the
// field-encryption extension. A Proxy `has`-trap regression that routed it
// through the extended client would silently decrypt/re-encrypt on read/write.
describe('PrismaService.rawClient (unextended accessor)', () => {
  it('exposes a client with model delegates that is not the extended proxy', () => {
    const svc = new PrismaService();
    expect(typeof svc.rawClient.encryptedSecret.findMany).toBe('function');
    expect(svc.rawClient).not.toBe(svc as unknown as typeof svc.rawClient);
  });
});
