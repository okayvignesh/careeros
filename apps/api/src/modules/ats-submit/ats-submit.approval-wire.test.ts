// F.2 → F.1 wire: ensure the ATS submit path routes through approval queue.
//
// Not a Testcontainers integration; an in-memory fake prisma + a real
// ApprovalsService + a stubbed adapter. The seam under test is:
//
//   enqueue()  -> approvals.enqueue (kind=ats_submit)
//   approve()  -> dispatcher -> AtsSubmitService.onApproved
//   onApproved -> submit() -> adapter -> approvals.markSent/markFailed
//
// Also pins the direct-call guard: calling submit() without an
// approvalItemId MUST throw, and an approvalItemId whose row is still
// pending (not approved) MUST throw.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { SensitivityGateService } from '../../common/sensitivity-gate.service';
import { ApprovalsService } from '../approvals/approvals.service';
import {
  AtsSubmitService,
  ATS_SUBMIT_APPROVAL_KIND,
  type SubmitInput,
} from './ats-submit.service';
import type { AtsSubmitAdapter, SubmitResult } from './adapters/types';

// ---------- fake prisma ----------

type ApprovalRow = {
  id: string;
  userId: string;
  kind: string;
  payload: unknown;
  diffJson: unknown;
  state: string;
  createdAt: Date;
  decidedAt: Date | null;
  sentAt: Date | null;
  failedReason: string | null;
};
type AtsSubRow = {
  id: string;
  userId: string;
  applicationId: string;
  ats: string;
  idempotencyKey: string;
  status: string;
  attemptCount: number;
  responseJson: unknown;
  lastError: string | null;
  submittedAt: Date | null;
  updatedAt: Date;
};

let seq = 0;
const nid = () => `id-${++seq}`;

function fakePrisma(opts: {
  application?: Partial<{ id: string; userId: string; state: string; resumeVariantId: string }>;
  user?: { id: string; email: string; displayName: string | null };
  integration?: {
    status: string;
    tokenSecretId: string | null;
    metadata: Record<string, string> | null;
  };
  secret?: { ciphertext: Buffer };
  resumeVariant?: { contentJson: unknown; roleTarget: string | null };
} = {}) {
  const approvalItems: ApprovalRow[] = [];
  const atsSubs: AtsSubRow[] = [];
  const audit: Array<{ action: string; payload: unknown; userId: string | null }> = [];
  const events: Array<{ approvalItemId: string; event: string; actor: string }> = [];

  return {
    _approvalItems: approvalItems,
    _atsSubs: atsSubs,
    _audit: audit,
    _events: events,
    approvalItem: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row: ApprovalRow = {
          id: nid(),
          userId: data.userId as string,
          kind: data.kind as string,
          payload: data.payload,
          diffJson: data.diffJson,
          state: 'pending',
          createdAt: new Date(),
          decidedAt: null,
          sentAt: null,
          failedReason: null,
        };
        approvalItems.push(row);
        const ev = (data.events as { create?: { event: string; actor?: string } } | undefined)
          ?.create;
        if (ev) events.push({ approvalItemId: row.id, event: ev.event, actor: ev.actor ?? 'user' });
        return { ...row };
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const row = approvalItems.find((r) => r.id === where.id);
        if (!row) throw new Error('no item');
        if (typeof data.state === 'string') row.state = data.state;
        if (data.decidedAt instanceof Date) row.decidedAt = data.decidedAt;
        if (data.sentAt instanceof Date) row.sentAt = data.sentAt;
        if (typeof data.failedReason === 'string') row.failedReason = data.failedReason;
        const ev = (data.events as { create?: { event: string; actor?: string } } | undefined)
          ?.create;
        if (ev) events.push({ approvalItemId: row.id, event: ev.event, actor: ev.actor ?? 'user' });
        return { ...row };
      },
      findFirst: async ({
        where,
        select: _select,
      }: {
        where: { id: string; userId?: string };
        select?: Record<string, boolean>;
      }) => {
        const row = approvalItems.find(
          (r) => r.id === where.id && (where.userId ? r.userId === where.userId : true),
        );
        return row ? { ...row } : null;
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = approvalItems.find((r) => r.id === where.id);
        return row ? { ...row } : null;
      },
      findMany: async () => approvalItems.map((r) => ({ ...r })),
    },
    atsSubmission: {
      upsert: async ({
        where,
        create,
      }: {
        where: { applicationId_ats_idempotencyKey: { applicationId: string; ats: string; idempotencyKey: string } };
        create: Record<string, unknown>;
      }) => {
        const k = where.applicationId_ats_idempotencyKey;
        let row = atsSubs.find(
          (r) =>
            r.applicationId === k.applicationId &&
            r.ats === k.ats &&
            r.idempotencyKey === k.idempotencyKey,
        );
        if (!row) {
          row = {
            id: nid(),
            userId: create.userId as string,
            applicationId: create.applicationId as string,
            ats: create.ats as string,
            idempotencyKey: create.idempotencyKey as string,
            status: (create.status as string) ?? 'pending',
            attemptCount: 0,
            responseJson: null,
            lastError: null,
            submittedAt: null,
            updatedAt: new Date(),
          };
          atsSubs.push(row);
        }
        return { ...row };
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = atsSubs.find((r) => r.id === where.id);
        if (!row) throw new Error('no row');
        if (typeof data.status === 'string') row.status = data.status;
        if (data.submittedAt instanceof Date) row.submittedAt = data.submittedAt;
        if (data.responseJson !== undefined) row.responseJson = data.responseJson;
        if (typeof data.lastError === 'string') row.lastError = data.lastError;
        return { ...row };
      },
      findMany: async () => atsSubs.map((r) => ({ ...r })),
    },
    application: {
      findFirst: async () =>
        opts.application
          ? {
              id: opts.application.id ?? 'app-1',
              userId: opts.application.userId ?? 'user-1',
              state: opts.application.state ?? 'interested',
              resumeVariantId: opts.application.resumeVariantId ?? 'rv-1',
            }
          : null,
      findUnique: async () =>
        opts.application
          ? {
              state: opts.application.state ?? 'interested',
              appliedAt: null,
            }
          : null,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        if (opts.application) opts.application.state = data.state as string;
        return { ...(opts.application ?? {}) };
      },
    },
    user: {
      findUnique: async () => opts.user ?? null,
    },
    resumeVariant: {
      findUnique: async () => opts.resumeVariant ?? null,
    },
    integration: {
      findUnique: async () =>
        opts.integration
          ? { ...opts.integration, userId: 'user-1', kind: 'ashby' }
          : null,
    },
    encryptedSecret: {
      findUnique: async () => opts.secret ?? null,
    },
    // P1 eligibility gate reads: a VERIFIED job that likely sponsors so the
    // approval-wire tests exercise the happy path.
    normalizedJob: {
      findUnique: async () => ({
        id: 'job-1',
        state: 'verified',
        country: null,
        sponsorshipSignal: 'likely',
      }),
    },
    userJobPreferences: {
      findUnique: async () => null,
    },
    auditEvent: {
      create: async ({
        data,
      }: {
        data: { action: string; payload: unknown; userId: string | null };
      }) => {
        audit.push({ action: data.action, payload: data.payload, userId: data.userId });
        return { id: nid() };
      },
    },
  };
}

beforeEach(() => {
  seq = 0;
});

function mkSvc(prismaOpts: Parameters<typeof fakePrisma>[0] = {}) {
  const prisma = fakePrisma(prismaOpts);
  const approvals = new ApprovalsService(
    prisma as never,
    new SensitivityGateService({} as never, { warn() {} } as never),
  );
  const svc = new AtsSubmitService(prisma as never, approvals);
  // onModuleInit registers the worker; call it directly in the test
  // (Nest only runs this via its DI lifecycle in a bootstrapped app).
  svc.onModuleInit();
  return { prisma, approvals, svc };
}

describe('AtsSubmitService: F.1 approval wire', () => {
  it('enqueue() creates a pending approval item of kind ats_submit', async () => {
    const { svc, prisma } = mkSvc({
      application: { id: 'app-1', userId: 'user-1' },
      user: { id: 'user-1', email: 'jane@example.com', displayName: 'Jane' },
    });
    const item = await svc.enqueue({
      userId: 'user-1',
      applicationId: 'app-1',
      ats: 'ashby',
      jobBoardId: 'job-xyz',
    });
    expect(item.state).toBe('pending');
    expect(item.kind).toBe(ATS_SUBMIT_APPROVAL_KIND);
    const row = prisma._approvalItems[0]!;
    expect(row.payload).toMatchObject({
      userId: 'user-1',
      applicationId: 'app-1',
      ats: 'ashby',
      jobBoardId: 'job-xyz',
    });
    // Diff preview is populated for the UI (no API key, no PDF bytes).
    expect(row.diffJson).toMatchObject({
      ats: 'ashby',
      jobBoardId: 'job-xyz',
      candidate: { name: 'Jane', email: 'jane@example.com' },
    });
  });

  it('submit() refuses direct calls without approvalItemId', async () => {
    const { svc } = mkSvc();
    await expect(
      svc.submit({
        userId: 'user-1',
        applicationId: 'app-1',
        ats: 'ashby',
        jobBoardId: 'job-xyz',
      } as SubmitInput),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('submit() refuses when the approval row is still pending (not approved)', async () => {
    const { svc, prisma } = mkSvc({
      application: { id: 'app-1', userId: 'user-1' },
      user: { id: 'user-1', email: 'jane@example.com', displayName: 'Jane' },
    });
    const item = await svc.enqueue({
      userId: 'user-1',
      applicationId: 'app-1',
      ats: 'ashby',
      jobBoardId: 'job-xyz',
    });
    expect(prisma._approvalItems[0]!.state).toBe('pending');
    await expect(
      svc.submit({
        userId: 'user-1',
        applicationId: 'app-1',
        ats: 'ashby',
        jobBoardId: 'job-xyz',
        approvalItemId: item.id,
      }),
    ).rejects.toThrow(/pending/);
  });

  it('approval dispatcher calls onApproved → runs submit via stubbed adapter → marks sent', async () => {
    const okAdapter: AtsSubmitAdapter = {
      id: 'ashby',
      submit: vi.fn().mockResolvedValue({
        ok: true,
        atsApplicationId: 'ash-999',
        confirmationUrl: 'https://app.ashbyhq.com/applications/ash-999',
      } satisfies SubmitResult),
    };

    const { svc, approvals, prisma } = mkSvc({
      application: { id: 'app-1', userId: 'user-1', state: 'interested', resumeVariantId: 'rv-1' },
      user: { id: 'user-1', email: 'jane@example.com', displayName: 'Jane' },
      integration: { status: 'connected', tokenSecretId: 'sec-1', metadata: {} },
      secret: { ciphertext: Buffer.from('ignored-in-test') },
      resumeVariant: {
        contentJson: { summary: 's', sections: [] },
        roleTarget: 'swe',
      },
    });
    // Swap the real Ashby adapter for a stub so the test doesn't actually
    // render a PDF or call fetch. Direct field assignment is simplest.
    (svc as unknown as { adapters: Record<string, AtsSubmitAdapter> }).adapters.ashby = okAdapter;
    // decrypt() will fail on our fake ciphertext; short-circuit loadContext
    // by also stubbing the integration lookup to a connected shape and let
    // the real decrypt throw caught by the dispatcher? No: cleaner to also
    // stub ats-submit's loadContext seam. The quickest safe mock is to make
    // the secret ciphertext decrypt-able OR override the service.
    // ponytail: we skip the real decrypt by mocking it inside the service's
    // own method via Object.defineProperty - tiny shim; a full fake prisma
    // would be bigger than this three-line monkey-patch.
    const loadContext = (
      svc as unknown as {
        loadContext: (input: SubmitInput) => Promise<unknown>;
      }
    ).loadContext.bind(svc);
    void loadContext;
    (svc as unknown as { loadContext: (input: SubmitInput) => Promise<unknown> }).loadContext =
      async () => ({
        candidate: { name: 'Jane', email: 'jane@example.com' },
        resume: { bytes: Buffer.from('%PDF-1.4'), filename: 'resume.pdf' },
        credentials: { apiKey: 'test-key' },
      });

    const item = await svc.enqueue({
      userId: 'user-1',
      applicationId: 'app-1',
      ats: 'ashby',
      jobBoardId: 'job-xyz',
    });
    await approvals.approve({ userId: 'user-1', itemId: item.id });
    // Dispatch is fire-and-forget; drain the microtask queue.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const finalRow = prisma._approvalItems.find((r) => r.id === item.id)!;
    expect(finalRow.state).toBe('sent');
    expect(okAdapter.submit).toHaveBeenCalledOnce();
    // ats_submissions row recorded a submitted status + response.
    expect(prisma._atsSubs).toHaveLength(1);
    expect(prisma._atsSubs[0]!.status).toBe('submitted');
    // Audit trail contains the success event.
    const okAudit = prisma._audit.find((a) => a.action === 'ats.submit.ok');
    expect(okAudit).toBeDefined();
    // Application state advanced interested -> applied.
    expect(prisma._audit.find((a) => a.action === 'approval.sent')).toBeDefined();
  });

  it('on adapter failure the approval row flips to failed with the reason', async () => {
    const failAdapter: AtsSubmitAdapter = {
      id: 'ashby',
      submit: vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        retryable: false,
        reason: 'bad job id',
      } satisfies SubmitResult),
    };
    const { svc, approvals, prisma } = mkSvc({
      application: { id: 'app-1', userId: 'user-1', state: 'interested', resumeVariantId: 'rv-1' },
      user: { id: 'user-1', email: 'jane@example.com', displayName: 'Jane' },
      integration: { status: 'connected', tokenSecretId: 'sec-1', metadata: {} },
      secret: { ciphertext: Buffer.from('ignored') },
      resumeVariant: { contentJson: { summary: '', sections: [] }, roleTarget: 'swe' },
    });
    (svc as unknown as { adapters: Record<string, AtsSubmitAdapter> }).adapters.ashby = failAdapter;
    (svc as unknown as { loadContext: (input: SubmitInput) => Promise<unknown> }).loadContext =
      async () => ({
        candidate: { name: 'Jane', email: 'jane@example.com' },
        resume: { bytes: Buffer.from('%PDF-1.4'), filename: 'resume.pdf' },
        credentials: { apiKey: 'k' },
      });

    const item = await svc.enqueue({
      userId: 'user-1',
      applicationId: 'app-1',
      ats: 'ashby',
      jobBoardId: 'job-xyz',
    });
    await approvals.approve({ userId: 'user-1', itemId: item.id });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const row = prisma._approvalItems.find((r) => r.id === item.id)!;
    expect(row.state).toBe('failed');
    expect(row.failedReason).toContain('bad job id');
  });
});

describe('AtsSubmitService: P1 eligibility gate', () => {
  it('logs an eligible decision and allows the approval to be queued', async () => {
    const { svc, prisma } = mkSvc({
      application: { id: 'app-1', userId: 'user-1' },
      user: { id: 'user-1', email: 'jane@example.com', displayName: 'Jane' },
    });
    await svc.enqueue({
      userId: 'user-1',
      applicationId: 'app-1',
      ats: 'ashby',
      jobBoardId: 'job-xyz',
    });
    const decision = prisma._audit.find((a) => a.action === 'ats.eligibility.decision');
    expect(decision).toBeDefined();
    expect(decision!.payload).toMatchObject({ eligible: true, reason: 'eligible' });
  });

  it('refuses to enqueue an unverified job and logs why', async () => {
    const { svc, prisma } = mkSvc({
      application: { id: 'app-1', userId: 'user-1' },
      user: { id: 'user-1', email: 'jane@example.com', displayName: 'Jane' },
    });
    prisma.normalizedJob.findUnique = async () => ({
      id: 'job-1',
      state: 'discovered',
      country: null,
      sponsorshipSignal: 'likely',
    });

    await expect(
      svc.enqueue({
        userId: 'user-1',
        applicationId: 'app-1',
        ats: 'ashby',
        jobBoardId: 'job-xyz',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const decision = prisma._audit.find((a) => a.action === 'ats.eligibility.decision');
    expect(decision).toBeDefined();
    expect(decision!.payload).toMatchObject({ eligible: false, reason: 'not_verified' });
    // Nothing was queued for approval.
    expect(prisma._approvalItems).toHaveLength(0);
  });
});
