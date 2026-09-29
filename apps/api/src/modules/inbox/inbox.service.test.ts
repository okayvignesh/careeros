import { describe, expect, it } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { InboxService, type IngestInput } from './inbox.service';

/**
 * E.7 unit tests. Fakes prisma with only the surfaces the service uses.
 * Focus is on the auto-link decision + upsert idempotency + manual
 * override paths - the fuzzy math itself is covered by
 * packages/shared/src/fuzzy-match.test.ts.
 */

interface FakeInboxRow {
  id: string;
  userId: string;
  emailId: string;
  fromAddress: string;
  subject: string;
  snippet: string | null;
  class: string;
  classConfidence: number;
  linkedApplicationId: string | null;
  status: string;
  arrivedAt: Date;
  reviewedAt: Date | null;
}

interface FakeLinkRow {
  id: string;
  inboxItemId: string;
  applicationId: string;
  userId: string;
  confidence: number;
  by: string;
  linkedAt: Date;
  unlinkedAt: Date | null;
}

function fakePrisma(seed: {
  applications?: Array<{ id: string; userId: string; jobId: string; state: string }>;
  jobs?: Array<{ id: string; title: string; company: string }>;
} = {}): {
  service: PrismaService;
  state: {
    inbox: Map<string, FakeInboxRow>;
    links: FakeLinkRow[];
  };
} {
  const state = {
    inbox: new Map<string, FakeInboxRow>(),
    links: [] as FakeLinkRow[],
  };
  let idCtr = 0;
  const nextId = () => `id-${++idCtr}`;
  const svc = {
    application: {
      findMany: async (args: { where: { userId: string; state: unknown } }) => {
        return (seed.applications ?? []).filter(
          (a) => a.userId === args.where.userId,
        );
      },
      findFirst: async (args: { where: { id: string; userId: string } }) => {
        return (
          (seed.applications ?? []).find(
            (a) => a.id === args.where.id && a.userId === args.where.userId,
          ) ?? null
        );
      },
    },
    normalizedJob: {
      findMany: async (args: { where: { id: { in: string[] } } }) =>
        (seed.jobs ?? []).filter((j) => args.where.id.in.includes(j.id)),
    },
    inboxItem: {
      upsert: async (args: {
        where: { userId_emailId: { userId: string; emailId: string } };
        create: Omit<FakeInboxRow, 'id' | 'arrivedAt' | 'reviewedAt'> & { snippet: string | null };
        update: Partial<FakeInboxRow>;
        select?: unknown;
      }) => {
        const key = `${args.where.userId_emailId.userId}::${args.where.userId_emailId.emailId}`;
        const existing = state.inbox.get(key);
        if (existing) {
          Object.assign(existing, args.update);
          return { id: existing.id, status: existing.status, linkedApplicationId: existing.linkedApplicationId };
        }
        const row: FakeInboxRow = {
          id: nextId(),
          userId: args.create.userId,
          emailId: args.create.emailId,
          fromAddress: args.create.fromAddress,
          subject: args.create.subject,
          snippet: args.create.snippet,
          class: args.create.class,
          classConfidence: args.create.classConfidence,
          linkedApplicationId: args.create.linkedApplicationId ?? null,
          status: args.create.status,
          arrivedAt: new Date(),
          reviewedAt: null,
        };
        state.inbox.set(key, row);
        return { id: row.id, status: row.status, linkedApplicationId: row.linkedApplicationId };
      },
      findFirst: async (args: { where: { id: string; userId: string } }) => {
        for (const row of state.inbox.values()) {
          if (row.id === args.where.id && row.userId === args.where.userId) return row;
        }
        return null;
      },
      update: async (args: { where: { id: string }; data: Partial<FakeInboxRow> }) => {
        for (const row of state.inbox.values()) {
          if (row.id === args.where.id) {
            Object.assign(row, args.data);
            return row;
          }
        }
        throw new Error('not found');
      },
      findMany: async (args: { where: { userId: string; status?: string } }) => {
        return [...state.inbox.values()].filter(
          (r) => r.userId === args.where.userId && (!args.where.status || r.status === args.where.status),
        );
      },
    },
    emailApplicationLink: {
      upsert: async (args: {
        where: { inboxItemId_applicationId: { inboxItemId: string; applicationId: string } };
        create: Omit<FakeLinkRow, 'id' | 'linkedAt' | 'unlinkedAt'>;
        update: Partial<FakeLinkRow>;
      }) => {
        const existing = state.links.find(
          (l) =>
            l.inboxItemId === args.where.inboxItemId_applicationId.inboxItemId &&
            l.applicationId === args.where.inboxItemId_applicationId.applicationId,
        );
        if (existing) {
          Object.assign(existing, args.update);
          return existing;
        }
        const row: FakeLinkRow = {
          id: nextId(),
          userId: args.create.userId,
          inboxItemId: args.create.inboxItemId,
          applicationId: args.create.applicationId,
          confidence: args.create.confidence,
          by: args.create.by,
          linkedAt: new Date(),
          unlinkedAt: null,
        };
        state.links.push(row);
        return row;
      },
      updateMany: async (args: {
        where: { inboxItemId: string; applicationId: string; unlinkedAt: null };
        data: { unlinkedAt: Date };
      }) => {
        let count = 0;
        for (const l of state.links) {
          if (
            l.inboxItemId === args.where.inboxItemId &&
            l.applicationId === args.where.applicationId &&
            l.unlinkedAt === null
          ) {
            l.unlinkedAt = args.data.unlinkedAt;
            count += 1;
          }
        }
        return { count };
      },
    },
    $transaction: async (calls: unknown[]) => Promise.all(calls),
  };
  return { service: svc as unknown as PrismaService, state };
}

const BASE_INPUT: IngestInput = {
  userId: 'u-1',
  emailId: 'gmail-1',
  from: 'recruiter@stripe.com',
  subject: 'Interview scheduling',
  snippet: 'Congrats on advancing to the next round...',
  emailClass: 'interview_invite',
  classConfidence: 0.92,
  parsed: { company: 'Stripe', role: 'Backend Engineer' },
};

describe('InboxService.ingest', () => {
  it('auto-links on exact match (confidence 1.0)', async () => {
    const { service, state } = fakePrisma({
      applications: [{ id: 'a1', userId: 'u-1', jobId: 'j1', state: 'applied' }],
      jobs: [{ id: 'j1', title: 'Backend Engineer', company: 'Stripe' }],
    });
    const svc = new InboxService(service);
    const result = await svc.ingest(BASE_INPUT);
    expect(result.status).toBe('linked');
    expect(result.linkedApplicationId).toBe('a1');
    expect(result.matchConfidence).toBe(1);
    expect(state.links).toHaveLength(1);
    expect(state.links[0]!.by).toBe('auto');
  });

  it('stays as new on single-field match (below auto-link threshold)', async () => {
    const { service, state } = fakePrisma({
      applications: [{ id: 'a1', userId: 'u-1', jobId: 'j1', state: 'applied' }],
      jobs: [{ id: 'j1', title: 'Frontend Engineer', company: 'Stripe' }],
    });
    const svc = new InboxService(service);
    const result = await svc.ingest(BASE_INPUT);
    // Company matches, role does not: score = 0.5 = below 0.85 threshold.
    expect(result.status).toBe('new');
    expect(result.linkedApplicationId).toBeNull();
    expect(result.matchConfidence).toBe(0.5);
    expect(state.links).toHaveLength(0);
    // MUTATION-SMOKE: raise scoreEmailAgainstApplication single-field
    // confidence to 0.9 and this test flips to linked.
  });

  it('is idempotent on retry with the same emailId', async () => {
    const { service, state } = fakePrisma();
    const svc = new InboxService(service);
    await svc.ingest(BASE_INPUT);
    await svc.ingest(BASE_INPUT);
    expect(state.inbox.size).toBe(1);
  });

  it('degrades gracefully with no candidate applications', async () => {
    const { service } = fakePrisma();
    const svc = new InboxService(service);
    const result = await svc.ingest(BASE_INPUT);
    expect(result.status).toBe('new');
    expect(result.linkedApplicationId).toBeNull();
    expect(result.matchConfidence).toBeNull();
  });
});

describe('InboxService.linkManual + unlink + dismiss', () => {
  it('linkManual creates a user-attributed link + flips status', async () => {
    const { service, state } = fakePrisma({
      applications: [{ id: 'a1', userId: 'u-1', jobId: 'j1', state: 'applied' }],
    });
    const svc = new InboxService(service);
    await svc.ingest({ ...BASE_INPUT, parsed: { company: null, role: null } });
    const item = [...state.inbox.values()][0]!;
    await svc.linkManual('u-1', item.id, 'a1');
    expect(item.linkedApplicationId).toBe('a1');
    expect(item.status).toBe('linked');
    expect(state.links[0]!.by).toBe('user');
    expect(state.links[0]!.confidence).toBe(1);
  });

  it('linkManual throws when application does not belong to the user', async () => {
    const { service, state } = fakePrisma({
      applications: [{ id: 'a1', userId: 'u-OTHER', jobId: 'j1', state: 'applied' }],
    });
    const svc = new InboxService(service);
    await svc.ingest({ ...BASE_INPUT, parsed: { company: null, role: null } });
    const item = [...state.inbox.values()][0]!;
    await expect(svc.linkManual('u-1', item.id, 'a1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('unlink clears the link + flips status back to new', async () => {
    const { service, state } = fakePrisma({
      applications: [{ id: 'a1', userId: 'u-1', jobId: 'j1', state: 'applied' }],
      jobs: [{ id: 'j1', title: 'Backend Engineer', company: 'Stripe' }],
    });
    const svc = new InboxService(service);
    await svc.ingest(BASE_INPUT);
    const item = [...state.inbox.values()][0]!;
    await svc.unlink('u-1', item.id);
    expect(item.linkedApplicationId).toBeNull();
    expect(item.status).toBe('new');
    expect(state.links[0]!.unlinkedAt).not.toBeNull();
  });

  it('unlink on an unlinked item throws BadRequest', async () => {
    const { service, state } = fakePrisma();
    const svc = new InboxService(service);
    await svc.ingest({ ...BASE_INPUT, parsed: { company: null, role: null } });
    const item = [...state.inbox.values()][0]!;
    await expect(svc.unlink('u-1', item.id)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('dismiss flips status', async () => {
    const { service, state } = fakePrisma();
    const svc = new InboxService(service);
    await svc.ingest(BASE_INPUT);
    const item = [...state.inbox.values()][0]!;
    await svc.dismiss('u-1', item.id);
    expect(item.status).toBe('dismissed');
    expect(item.reviewedAt).not.toBeNull();
  });
});
