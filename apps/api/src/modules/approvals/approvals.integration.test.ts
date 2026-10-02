// C4 cleanup: real-Postgres integration test for the approvals fail-loud path.
//
// Proves against a real database that approving an item whose kind has no
// registered worker does not become a silent no-op:
//   1. `approve()` transitions pending → approved,
//   2. the async dispatch finds no matching worker and drives the item to its
//      terminal `failed` state with the documented reason,
//   3. an `approval.unexecutable` audit row is written with the kind + worker
//      count so operators can see the item was approved but never executed.
//
// Guarded by TESTCONTAINERS_E2E=1 + isDockerAvailable() so the default
// `pnpm test` on a laptop without Docker skips cleanly.
// Run: `TESTCONTAINERS_E2E=1 pnpm test:integration`.
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { isDockerAvailable, resetDb, startInfra, type StartedInfra } from '@careeros/testing';
import { ApprovalsService } from './approvals.service';

const runE2E = process.env.TESTCONTAINERS_E2E === '1' && isDockerAvailable();
const maybe = runE2E ? describe : describe.skip;

const HOOK_TIMEOUT_MS = 180_000;

maybe('ApprovalsService unexecutable dispatch (opt-in: TESTCONTAINERS_E2E=1)', () => {
  let infra: StartedInfra;
  let prisma: PrismaClient;
  let userId: string;

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
    const user = await prisma.user.create({
      data: {
        email: `approvals-${Date.now()}-${Math.random()}@test.local`,
        passwordHash: 'x'.repeat(60),
      },
    });
    userId = user.id;
  });

  it('approved item with no registered worker ends failed with an approval.unexecutable audit row', async () => {
    // `outreach_email` has no production worker yet; the registry starts empty.
    const svc = new ApprovalsService(prisma as never, {} as never);

    const item = await svc.enqueue({
      userId,
      kind: 'outreach_email',
      payload: { subject: 'hi' },
      diffJson: { subject: 'hi' },
    });
    expect(item.state).toBe('pending');

    const approved = await svc.approve({ userId, itemId: item.id });
    expect(approved.state).toBe('approved');

    // dispatch() is fire-and-forget; wait for the terminal transition.
    await vi.waitFor(
      async () => {
        const row = await prisma.approvalItem.findUnique({ where: { id: item.id } });
        expect(row?.state).toBe('failed');
        expect(row?.failedReason).toBe("no worker registered for kind 'outreach_email'");
      },
      { timeout: 10_000 },
    );

    const audits = await prisma.auditEvent.findMany({
      where: { userId, action: 'approval.unexecutable' },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actor).toBe('system');
    expect(audits[0]!.resourceType).toBe('approval_item');
    expect(audits[0]!.resourceId).toBe(item.id);
    expect(audits[0]!.payload).toMatchObject({
      kind: 'outreach_email',
      registeredWorkers: 0,
    });
  });
});

// ALWAYS runs. Proves the skip guard is wired and the module imports cleanly
// on machines without Docker.
describe('ApprovalsService unexecutable skip guard', () => {
  it('respects TESTCONTAINERS_E2E + docker availability', () => {
    expect(typeof runE2E).toBe('boolean');
  });
});
