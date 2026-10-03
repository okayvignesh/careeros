import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { UsageService } from '../usage/usage.service';
import type { UsageCache } from '../usage/usage.cache';
import type { SensitivityGateService } from '../../common/sensitivity-gate.service';
import { OutreachService } from './outreach.service';

/**
 * F.5 tests. Focus:
 *   - validation: unknown templateId / bad email / unknown variant
 *   - transition guards: draft -> approved -> sent + illegal transitions
 *   - discard rejects a sent row
 * Compose path itself needs a real provider to be end-to-end
 * meaningful; the fact-check + bogus-factRef guards are already unit-
 * tested at packages/ai/src/grounded/gate.ts and via F.4.
 */

interface FakeRow {
  id: string;
  userId: string;
  status: string;
  approvedAt: Date | null;
  sentAt: Date | null;
  gmailDraftId: string | null;
}

function fakePrisma(seed?: FakeRow): PrismaService {
  const state = new Map<string, FakeRow>();
  if (seed) state.set(seed.id, seed);
  return {
    outreachMessage: {
      findFirst: async (args: { where: { id: string; userId: string } }) => {
        const r = state.get(args.where.id);
        return r && r.userId === args.where.userId ? r : null;
      },
      update: async (args: { where: { id: string }; data: Partial<FakeRow> }) => {
        const r = state.get(args.where.id);
        if (!r) throw new Error('not found');
        Object.assign(r, args.data);
        return r;
      },
      findMany: async () => [...state.values()],
      create: async () => ({}),
    },
  } as unknown as PrismaService;
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

describe('OutreachService.compose (validation)', () => {
  it('rejects unknown templateId', async () => {
    const svc = new OutreachService(fakePrisma(), fakeUsage(), fakeUsageCache(), fakeSensitivity());
    await expect(
      svc.compose({
        userId: 'u-1',
        templateId: 'bogus',
        recipient: { email: 'jane@acme.com' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects unknown industryVariant', async () => {
    const svc = new OutreachService(fakePrisma(), fakeUsage(), fakeUsageCache(), fakeSensitivity());
    await expect(
      svc.compose({
        userId: 'u-1',
        templateId: 'cold-reach',
        industryVariant: 'wat',
        recipient: { email: 'jane@acme.com' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a bad recipient email', async () => {
    const svc = new OutreachService(fakePrisma(), fakeUsage(), fakeUsageCache(), fakeSensitivity());
    await expect(
      svc.compose({
        userId: 'u-1',
        templateId: 'cold-reach',
        recipient: { email: 'not-an-email' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('OutreachService state transitions', () => {
  it('approve: draft -> approved', async () => {
    const row: FakeRow = {
      id: 'o-1',
      userId: 'u-1',
      status: 'draft',
      approvedAt: null,
      sentAt: null,
      gmailDraftId: null,
    };
    const svc = new OutreachService(fakePrisma(row), fakeUsage(), fakeUsageCache(), fakeSensitivity());
    await svc.approve('u-1', 'o-1');
    expect(row.status).toBe('approved');
    expect(row.approvedAt).not.toBeNull();
  });

  it('approve refuses when not in draft state', async () => {
    const row: FakeRow = {
      id: 'o-1',
      userId: 'u-1',
      status: 'sent',
      approvedAt: null,
      sentAt: null,
      gmailDraftId: null,
    };
    const svc = new OutreachService(fakePrisma(row), fakeUsage(), fakeUsageCache(), fakeSensitivity());
    await expect(svc.approve('u-1', 'o-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('markSent: approved -> sent + records gmailDraftId', async () => {
    const row: FakeRow = {
      id: 'o-1',
      userId: 'u-1',
      status: 'approved',
      approvedAt: new Date(),
      sentAt: null,
      gmailDraftId: null,
    };
    const svc = new OutreachService(fakePrisma(row), fakeUsage(), fakeUsageCache(), fakeSensitivity());
    await svc.markSent('u-1', 'o-1', 'gmail-draft-42');
    expect(row.status).toBe('sent');
    expect(row.sentAt).not.toBeNull();
    expect(row.gmailDraftId).toBe('gmail-draft-42');
  });

  it('discard refuses when row already sent', async () => {
    const row: FakeRow = {
      id: 'o-1',
      userId: 'u-1',
      status: 'sent',
      approvedAt: new Date(),
      sentAt: new Date(),
      gmailDraftId: null,
    };
    const svc = new OutreachService(fakePrisma(row), fakeUsage(), fakeUsageCache(), fakeSensitivity());
    await expect(svc.discard('u-1', 'o-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('transitions throw NotFound when row does not belong to user', async () => {
    const row: FakeRow = {
      id: 'o-1',
      userId: 'u-OTHER',
      status: 'draft',
      approvedAt: null,
      sentAt: null,
      gmailDraftId: null,
    };
    const svc = new OutreachService(fakePrisma(row), fakeUsage(), fakeUsageCache(), fakeSensitivity());
    await expect(svc.approve('u-1', 'o-1')).rejects.toBeInstanceOf(NotFoundException);
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
      // compose() never reaches these, but the service type expects the model.
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

  function service(prisma: ReturnType<typeof composePrisma>) {
    return new OutreachService(prisma, fakeUsage(), fakeUsageCache(), fakeSensitivity());
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
    const svc = service(prisma);
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
    const svc = service(prisma);
    const provider = stubProvider([draft, { results: [{ bulletIndex: 0, supported: true, reason: 'ok' }] }]);
    vi.spyOn(svc as never as { loadProvider: () => Promise<unknown> }, 'loadProvider').mockResolvedValue(provider);

    const out = await svc.compose(input);
    expect(out.ok).toBe(true);
    expect(prisma.created).toHaveLength(1);
  });
});
