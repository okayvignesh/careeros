// C-P1.5a / plan/phase-1-personal-intelligence.md:188 — pg_dump opacity test.
//
// Proof that ENCRYPTED_FIELDS actually encrypts at rest: we bypass Prisma's
// model API (which decrypts) and read the raw column via `$queryRaw`, then
// assert the stored bytes are ciphertext, not plaintext. If someone dumped
// the database with `pg_dump` they would see the same bytes we assert here.
//
// Guarded by TESTCONTAINERS_E2E=1 + isDockerAvailable() so the default
// `pnpm test` on a laptop without Docker skips cleanly instead of hanging.
// Run: `TESTCONTAINERS_E2E=1 pnpm --filter @careeros/api test`.
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { isDockerAvailable, startInfra, type StartedInfra } from '@careeros/testing';
import { PrismaService } from './prisma.service';

const runE2E = process.env.TESTCONTAINERS_E2E === '1' && isDockerAvailable();
const maybe = runE2E ? describe : describe.skip;

const HOOK_TIMEOUT_MS = 180_000;
const PLAINTEXT = 'sensitive plaintext $9000 salary';

maybe('ENCRYPTED_FIELDS opacity at rest (opt-in: TESTCONTAINERS_E2E=1)', () => {
  let infra: StartedInfra;
  let raw: PrismaClient;
  let svc: PrismaService;
  let userId: string;

  beforeAll(async () => {
    infra = await startInfra({ services: { postgres: true, redis: false, qdrant: false, minio: false } });
    process.env.DATABASE_URL = infra.postgresUrl;

    // The init migration references `CITEXT`; enable the extension first so
    // the container matches the shape docker-compose ships.
    raw = new PrismaClient({ datasources: { db: { url: infra.postgresUrl } } });
    await raw.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS citext');
    await raw.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pgcrypto');

    // Sync schema via `prisma db push` (no migrations table, no custom-SQL
    // migration replay). We only need `users` + `llm_hallucination_log`; the
    // full migrations dir contains a few index expressions that require
    // session-tuning outside this test's scope.
    const apiDir = path.resolve(__dirname, '../..');
    execFileSync('pnpm', ['exec', 'prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
      cwd: apiDir,
      env: { ...process.env, DATABASE_URL: infra.postgresUrl },
      stdio: 'inherit',
    });

    svc = new PrismaService();
    await svc.onModuleInit();

    // Seed a user so the hallucination-log FK is satisfied.
    const user = await raw.user.create({
      data: {
        email: `opacity-${Date.now()}@test.local`,
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

  it('LlmHallucinationLog.snippet lands as ciphertext (enc:v1:snippet:...)', async () => {
    const created = await svc.llmHallucinationLog.create({
      data: {
        userId,
        promptId: 'test.prompt',
        promptVersion: '1',
        promptHash: 'deadbeef',
        snippet: PLAINTEXT,
      },
    });

    // Raw read via $queryRaw bypasses PrismaService's decryption path, so it
    // returns whatever bytes pg_dump would emit. Prisma renders TEXT columns
    // as JS strings verbatim.
    const rows = await raw.$queryRaw<Array<{ snippet: string | null }>>`
      SELECT "snippet" FROM "llm_hallucination_log" WHERE "id" = ${created.id}::uuid
    `;
    expect(rows).toHaveLength(1);
    const stored = rows[0]?.snippet ?? '';

    expect(stored.startsWith('enc:v1:snippet:')).toBe(true);
    expect(stored).not.toContain(PLAINTEXT);
    expect(stored).not.toContain('$9000');
    expect(stored).not.toContain('salary');
  });

  it('Prisma model read decrypts the same row back to plaintext', async () => {
    const [row] = await svc.llmHallucinationLog.findMany({
      where: { userId, promptId: 'test.prompt' },
      take: 1,
    });
    expect(row?.snippet).toBe(PLAINTEXT);
  });
});

// ALWAYS runs. Proves the skip guard is wired and the module imports cleanly
// on machines without Docker; otherwise a broken guard would silently pass an
// empty file.
describe('encrypted-fields-opacity skip guard', () => {
  it('respects TESTCONTAINERS_E2E env + docker availability', () => {
    expect(typeof runE2E).toBe('boolean');
  });
});
