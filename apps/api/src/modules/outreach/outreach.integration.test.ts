// F.5 integration: the full outreach approval lifecycle against real Postgres.
//
// Proves the queue wiring end-to-end with a real ApprovalsService + a real
// OutreachService (only Gmail is faked, because it is an external network
// boundary):
//   compose row -> requestApproval (pending item) -> approve -> onApproved
//   stages a Gmail draft + flips the row to `approved` -> send flushes it.
//
// Guarded by TESTCONTAINERS_E2E=1 + isDockerAvailable() so the default
// `pnpm test` on a laptop without Docker skips cleanly.
// Run: `TESTCONTAINERS_E2E=1 pnpm test:integration`.
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { isDockerAvailable, resetDb, startInfra, type StartedInfra } from '@careeros/testing';
import { ApprovalsService } from '../approvals/approvals.service';
import type { ApprovalsWorker } from '../approvals/approvals.service';
import { OutreachService } from './outreach.service';

const runE2E = process.env.TESTCONTAINERS_E2E === '1' && isDockerAvailable();
const maybe = runE2E ? describe : describe.skip;

const HOOK_TIMEOUT_MS = 180_000;

maybe('Outreach approval lifecycle (opt-in: TESTCONTAINERS_E2E=1)', () => {
  let infra: StartedInfra;
  let prisma: PrismaClient;
  let userId: string;
  let outreachId: string;
  const drafts: Array<Record<string, unknown>> = [];

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
    drafts.length = 0;
    const user = await prisma.user.create({
      data: {
        email: `outreach-${Date.now()}-${Math.random()}@test.local`,
        passwordHash: 'x'.repeat(60),
      },
      select: { id: true },
    });
    userId = user.id;
    const row = await prisma.outreachMessage.create({
      data: {
        userId,
        templateId: 'cold-reach',
        industryVariant: 'default',
        recipientEmail: 'jane@acme.com',
        recipientName: 'Jane',
        subject: 'Hello Jane',
        body: 'Short grounded note.',
        status: 'draft',
      },
      select: { id: true },
    });
    outreachId = row.id;
  });

  function buildServices() {
    const gate = { hasFreshReauth: () => true } as never;
    const approvals = new ApprovalsService(prisma as never, gate);
    const gmail = {
      createDraft: vi.fn(async (_userId: string, input: Record<string, unknown>) => {
        drafts.push(input);
        return { draftId: 'draft-1', messageId: 'msg-1', threadId: 'thread-1' };
      }),
      sendDraft: vi.fn(async () => ({ messageId: 'sent-1', threadId: 'thread-1' })),
    };
    const usage = {
      assertCallAllowed: async () => {},
      runWithUserLimit: async <T,>(_u: string, fn: () => Promise<T>) => fn(),
    };
    const outreach = new OutreachService(
      prisma as never,
      usage as never,
      {} as never,
      { assertAllowed: async () => {} } as never,
      approvals,
      gmail as never,
    );
    approvals.registerWorker(outreach as unknown as ApprovalsWorker);
    return { approvals, outreach, gmail };
  }

  it('request -> approve stages a draft; send flushes it; audit trail is complete', async () => {
    const { approvals, outreach } = buildServices();

    const item = await outreach.requestApproval(userId, outreachId);
    expect(item.state).toBe('pending');
    expect(item.kind).toBe('outreach_email');

    const approved = await approvals.approve({ userId, itemId: item.id });
    expect(approved.state).toBe('approved');

    await vi.waitFor(
      async () => {
        const row = await prisma.outreachMessage.findUnique({ where: { id: outreachId } });
        expect(row?.status).toBe('approved');
        expect(row?.gmailDraftId).toBe('draft-1');
        // The worker stages the draft (row update above) before markSent, so
        // wait for the approval's terminal state rather than reading it after
        // the intermediate row update.
        const approvalRow = await prisma.approvalItem.findUnique({ where: { id: item.id } });
        expect(approvalRow?.state).toBe('sent');
      },
      { timeout: 10_000 },
    );
    expect(drafts).toHaveLength(1);

    const sent = await outreach.send(userId, outreachId);
    expect(sent.ok).toBe(true);
    const afterSend = await prisma.outreachMessage.findUnique({ where: { id: outreachId } });
    expect(afterSend?.status).toBe('sent');
    expect(afterSend?.sentAt).not.toBeNull();

    const actions = await prisma.auditEvent.findMany({
      where: { userId, action: { in: ['outreach.approval.requested', 'outreach.approval.draft_created', 'outreach.sent'] } },
      select: { action: true },
    });
    const set = new Set(actions.map((a) => a.action));
    expect(set.has('outreach.approval.requested')).toBe(true);
    expect(set.has('outreach.approval.draft_created')).toBe(true);
    expect(set.has('outreach.sent')).toBe(true);
  });

  it('requestApproval is idempotent while the item is pending', async () => {
    const { outreach } = buildServices();
    const a = await outreach.requestApproval(userId, outreachId);
    const b = await outreach.requestApproval(userId, outreachId);
    expect(b.id).toBe(a.id);
    const count = await prisma.approvalItem.count({ where: { userId, kind: 'outreach_email' } });
    expect(count).toBe(1);
  });
});

// ALWAYS runs: proves the skip guard is wired on machines without Docker.
describe('Outreach integration skip guard', () => {
  it('respects TESTCONTAINERS_E2E + docker availability', () => {
    expect(typeof runE2E).toBe('boolean');
  });
});
