import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { UsageService } from '../usage/usage.service';
import type { UsageCache } from '../usage/usage.cache';
import type { SensitivityGateService } from '../../common/sensitivity-gate.service';
import type { ApprovalsService, ApprovalItemDto } from '../approvals/approvals.service';
import type { GmailOutboundService } from '../gmail/gmail.outbound.service';
import { OutreachService, parseOutreachApprovalPayload } from './outreach.service';

/**
 * F.5 tests. Focus:
 *   - validation: unknown templateId / bad email / unknown variant
 *   - approval lifecycle: request -> stage draft -> send, idempotency, discard
 *   - payload narrowing
 * Compose's LLM path is exercised by the fact-check describe below; the Gmail
 * and approval-queue edges are faked here because they are external systems.
 */

interface FakeRow {
  id: string;
  userId: string;
  status: string;
  approvedAt: Date | null;
  sentAt: Date | null;
  gmailDraftId: string | null;
  subject?: string;
  body?: string;
  recipientEmail?: string;
  sendAt?: Date | null;
  replyMessageId?: string | null;
}

function fakePrisma(seed?: FakeRow): PrismaService & { updated: FakeRow[] } {
  const state = new Map<string, FakeRow>();
  const updated: FakeRow[] = [];
  if (seed) state.set(seed.id, seed);
  const prisma = {
    updated,
    outreachMessage: {
      findFirst: async (args: { where: { id: string; userId: string } }) => {
        const r = state.get(args.where.id);
        return r && r.userId === args.where.userId
          ? {
              id: r.id,
              userId: r.userId,
              status: r.status,
              subject: r.subject ?? 'subject',
              body: r.body ?? 'body',
              recipientEmail: r.recipientEmail ?? 'jane@acme.com',
              sendAt: r.sendAt ?? null,
              approvedAt: r.approvedAt,
              gmailDraftId: r.gmailDraftId,
              replyMessageId: r.replyMessageId ?? null,
            }
          : null;
      },
      update: async (args: { where: { id: string }; data: Partial<FakeRow> }) => {
        const r = state.get(args.where.id);
        if (!r) throw new Error('not found');
        Object.assign(r, args.data);
        updated.push(r);
        return r;
      },
      findMany: async () => [...state.values()],
      create: async () => ({}),
    },
    approvalItem: {
      findFirst: async () => null,
      findMany: async () => [],
    },
    auditEvent: { create: async () => ({ id: 'audit-1' }) },
  };
  return prisma as unknown as PrismaService & { updated: FakeRow[] };
}

interface FakeApprovals {
  enqueued: Array<Record<string, unknown>>;
  sent: Array<Record<string, unknown>>;
  failed: Array<Record<string, unknown>>;
  cancelled: Array<Record<string, unknown>>;
  registerWorker: (w: unknown) => void;
}

function fakeApprovals(): ApprovalsService & FakeApprovals {
  const enqueued: Array<Record<string, unknown>> = [];
  const sent: Array<Record<string, unknown>> = [];
  const failed: Array<Record<string, unknown>> = [];
  const cancelled: Array<Record<string, unknown>> = [];
  return {
    enqueued,
    sent,
    failed,
    cancelled,
    registerWorker: () => undefined,
    enqueue: async (input: Record<string, unknown>) => {
      enqueued.push(input);
      return {
        id: 'ap-1',
        userId: input.userId,
        kind: input.kind,
        payload: input.payload,
        diffJson: input.diffJson,
        state: 'pending',
        createdAt: new Date().toISOString(),
        decidedAt: null,
        sentAt: null,
        failedReason: null,
      } as ApprovalItemDto;
    },
    markSent: async (input: Record<string, unknown>) => {
      sent.push(input);
      return {} as ApprovalItemDto;
    },
    markFailed: async (input: Record<string, unknown>) => {
      failed.push(input);
      return {} as ApprovalItemDto;
    },
    cancel: async (input: Record<string, unknown>) => {
      cancelled.push(input);
      return {} as ApprovalItemDto;
    },
  } as unknown as ApprovalsService & FakeApprovals;
}

function fakeGmail(overrides: Partial<GmailOutboundService> = {}): GmailOutboundService {
  return {
    createDraft: async () => ({ draftId: 'draft-1', messageId: 'msg-1', threadId: 'thread-1' }),
    sendDraft: async () => ({ messageId: 'msg-1', threadId: 'thread-1' }),
    ...overrides,
  } as unknown as GmailOutboundService;
}

function fakeUsage(): UsageService {
  return {
    assertCallAllowed: async () => {},
    runWithUserLimit: async <T,>(_userId: string, fn: () => Promise<T>) => fn(),
  } as unknown as UsageService;
}

function fakeUsageCache(): UsageCache {
  return {} as unknown as UsageCache;
}

function fakeSensitivity(): SensitivityGateService {
  return { assertAllowed: async () => {} } as unknown as SensitivityGateService;
}

function service(
  prisma: PrismaService,
  approvals = fakeApprovals(),
  gmail = fakeGmail(),
): OutreachService {
  return new OutreachService(prisma, fakeUsage(), fakeUsageCache(), fakeSensitivity(), approvals, gmail);
}

describe('OutreachService.compose (validation)', () => {
  it('rejects unknown templateId', async () => {
    const svc = service(fakePrisma());
    await expect(
      svc.compose({ userId: 'u-1', templateId: 'bogus', recipient: { email: 'jane@acme.com' } }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects unknown industryVariant', async () => {
    const svc = service(fakePrisma());
    await expect(
      svc.compose({
        userId: 'u-1',
        templateId: 'cold-reach',
        industryVariant: 'bogus',
        recipient: { email: 'jane@acme.com' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a bad recipient email', async () => {
    const svc = service(fakePrisma());
    await expect(
      svc.compose({ userId: 'u-1', templateId: 'cold-reach', recipient: { email: 'not-an-email' } }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('OutreachService approval lifecycle', () => {
  const baseRow = (over: Partial<FakeRow> = {}): FakeRow => ({
    id: 'o-1',
    userId: 'u-1',
    status: 'draft',
    approvedAt: null,
    sentAt: null,
    gmailDraftId: null,
    subject: 'Hello',
    body: 'Body',
    recipientEmail: 'jane@acme.com',
    sendAt: null,
    ...over,
  });

  it('requestApproval enqueues an outreach_email item with the outreach id', async () => {
    const approvals = fakeApprovals();
    const svc = service(fakePrisma(baseRow()), approvals);
    const item = await svc.requestApproval('u-1', 'o-1');
    expect(item.kind).toBe('outreach_email');
    expect(approvals.enqueued).toHaveLength(1);
    expect(approvals.enqueued[0]).toMatchObject({
      userId: 'u-1',
      kind: 'outreach_email',
      payload: { userId: 'u-1', outreachMessageId: 'o-1' },
    });
  });

  it('requestApproval refuses a non-draft row', async () => {
    const svc = service(fakePrisma(baseRow({ status: 'sent' })));
    await expect(svc.requestApproval('u-1', 'o-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requestApproval throws NotFound for another user', async () => {
    const svc = service(fakePrisma(baseRow({ userId: 'u-OTHER' })));
    await expect(svc.requestApproval('u-1', 'o-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('onApproved stages a Gmail draft, flips status to approved, marks the item sent', async () => {
    const prisma = fakePrisma(baseRow());
    const approvals = fakeApprovals();
    const svc = service(prisma, approvals);
    const item: ApprovalItemDto = {
      id: 'ap-1',
      userId: 'u-1',
      kind: 'outreach_email',
      payload: { userId: 'u-1', outreachMessageId: 'o-1' },
      diffJson: {},
      state: 'approved',
      createdAt: new Date().toISOString(),
      decidedAt: null,
      sentAt: null,
      failedReason: null,
    };
    await svc.onApproved(item);
    expect(prisma.updated[0]).toMatchObject({ status: 'approved', gmailDraftId: 'draft-1' });
    expect(approvals.sent).toHaveLength(1);
    expect(approvals.sent[0]).toMatchObject({ itemId: 'ap-1' });
    expect(approvals.failed).toHaveLength(0);
  });

  it('onApproved is idempotent when a draft already exists', async () => {
    const prisma = fakePrisma(baseRow({ gmailDraftId: 'draft-existing', status: 'approved' }));
    const approvals = fakeApprovals();
    const gmail = fakeGmail({
      createDraft: vi.fn().mockRejectedValue(new Error('should not be called')),
    });
    const svc = service(prisma, approvals, gmail);
    await svc.onApproved({
      id: 'ap-1',
      userId: 'u-1',
      kind: 'outreach_email',
      payload: { userId: 'u-1', outreachMessageId: 'o-1' },
      diffJson: {},
      state: 'approved',
      createdAt: new Date().toISOString(),
      decidedAt: null,
      sentAt: null,
      failedReason: null,
    });
    expect(gmail.createDraft).not.toHaveBeenCalled();
    expect(approvals.sent).toHaveLength(1);
  });

  it('onApproved marks the item failed when Gmail drafting throws', async () => {
    const prisma = fakePrisma(baseRow());
    const approvals = fakeApprovals();
    const gmail = fakeGmail({ createDraft: vi.fn().mockRejectedValue(new Error('scope missing')) });
    const svc = service(prisma, approvals, gmail);
    await svc.onApproved({
      id: 'ap-1',
      userId: 'u-1',
      kind: 'outreach_email',
      payload: { userId: 'u-1', outreachMessageId: 'o-1' },
      diffJson: {},
      state: 'approved',
      createdAt: new Date().toISOString(),
      decidedAt: null,
      sentAt: null,
      failedReason: null,
    });
    expect(approvals.failed[0]).toMatchObject({ reason: 'scope missing' });
    expect(prisma.updated).toHaveLength(0);
  });

  it('send flushes the staged draft and records sentAt', async () => {
    const prisma = fakePrisma(baseRow({ status: 'approved', gmailDraftId: 'draft-1' }));
    const svc = service(prisma);
    const res = await svc.send('u-1', 'o-1');
    expect(res).toMatchObject({ ok: true, messageId: 'msg-1' });
    expect(prisma.updated[0]).toMatchObject({ status: 'sent' });
    expect(prisma.updated[0].sentAt).not.toBeNull();
  });

  it('send refuses when no draft is staged', async () => {
    const svc = service(fakePrisma(baseRow({ status: 'approved' })));
    await expect(svc.send('u-1', 'o-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('send is a no-op when already sent', async () => {
    const prisma = fakePrisma(baseRow({ status: 'sent', gmailDraftId: 'draft-1' }));
    const gmail = fakeGmail({ sendDraft: vi.fn() });
    const svc = service(prisma, fakeApprovals(), gmail);
    const res = await svc.send('u-1', 'o-1');
    expect(res.alreadySent).toBe(true);
    expect(gmail.sendDraft).not.toHaveBeenCalled();
  });

  it('discard cancels pending approvals and marks discarded', async () => {
    const prisma = fakePrisma(baseRow());
    const approvals = fakeApprovals();
    const svc = service(prisma, approvals);
    await svc.discard('u-1', 'o-1');
    expect(prisma.updated[0]).toMatchObject({ status: 'discarded' });
  });

  it('discard refuses a sent row', async () => {
    const svc = service(fakePrisma(baseRow({ status: 'sent' })));
    await expect(svc.discard('u-1', 'o-1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('parseOutreachApprovalPayload', () => {
  it('narrows a valid payload', () => {
    expect(parseOutreachApprovalPayload({ userId: 'u', outreachMessageId: 'o' })).toEqual({
      userId: 'u',
      outreachMessageId: 'o',
    });
  });
  it('returns null for malformed payloads', () => {
    expect(parseOutreachApprovalPayload(null)).toBeNull();
    expect(parseOutreachApprovalPayload({ userId: 'u' })).toBeNull();
    expect(parseOutreachApprovalPayload('nope')).toBeNull();
  });
});

// ai-safety item 6: the shared fact-check gate blocks unbacked outreach drafts
// before persist, with an actionable `reason` and no DB row.
describe('OutreachService.compose fact-check gate', () => {
  function composePrisma() {
    const created: unknown[] = [];
    return {
      created,
      evidence: {
        findMany: async () => [
          { id: 'e-1', kind: 'evidence', detail: { summary: 'Led a 12-service migration' }, sourceRef: { url: 'https://x.test' } },
        ],
      },
      outreachMessage: {
        create: async ({ data }: { data: unknown }) => {
          created.push(data);
          return { id: 'o-1', subject: (data as { subject: string }).subject, body: (data as { body: string }).body };
        },
      },
      normalizedJob: {},
    } as unknown as PrismaService & { created: unknown[] };
  }

  function stubProvider(script: unknown[]) {
    const calls: unknown[] = [];
    let i = 0;
    return {
      calls,
      chatStructured: async (input: unknown) => {
        calls.push(input);
        const out = script[i++];
        if (out instanceof Error) throw out;
        return out;
      },
    };
  }

  function svcFor(prisma: ReturnType<typeof composePrisma>) {
    return service(prisma);
  }

  const draft = {
    subject: 'Quick question about the platform role',
    body: 'Hi Jane,\n\nI led a 12-service migration at my last role and would love to compare notes.\n\nWould 15 minutes work?',
    factRefs: ['e-1'],
  };
  const input = {
    userId: 'u-1',
    templateId: 'cold-reach',
    recipient: { email: 'jane@acme.com', name: 'Jane', company: 'Acme' },
  };

  it('rejects + does not persist when the fact-check flags the body', async () => {
    const prisma = composePrisma();
    const svc = svcFor(prisma);
    const provider = stubProvider([
      draft,
      { results: [{ bulletIndex: 0, supported: false, reason: 'claim exceeds cited evidence' }] },
    ]);
    vi.spyOn(svc as never as { loadProvider: () => Promise<unknown> }, 'loadProvider').mockResolvedValue(provider);

    const out = await svc.compose(input);
    expect(out.ok).toBe(false);
    expect(out.outreachMessageId).toBeNull();
    expect(out.reason).toContain('claim exceeds cited evidence');
    expect(prisma.created).toHaveLength(0);
  });

  it('persists when the body is supported', async () => {
    const prisma = composePrisma();
    const svc = svcFor(prisma);
    const provider = stubProvider([draft, { results: [{ bulletIndex: 0, supported: true, reason: 'ok' }] }]);
    vi.spyOn(svc as never as { loadProvider: () => Promise<unknown> }, 'loadProvider').mockResolvedValue(provider);

    const out = await svc.compose(input);
    expect(out.ok).toBe(true);
    expect(prisma.created).toHaveLength(1);
  });
});
