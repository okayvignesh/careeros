import { describe, expect, it, beforeEach, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { SensitivityGate } from '@careeros/ai';
import {
  ApprovalsService,
  type ApprovalItemDto,
  type ApprovalsWorker,
} from './approvals.service';
import {
  APPROVAL_REAUTH_OP,
  IllegalStateError,
  type ApprovalKind,
} from './state-machine';

// -----------------------------------------------------------------------------
// In-memory prisma fake. Just enough surface to drive the service.
// -----------------------------------------------------------------------------

type Row = {
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

type EventRow = {
  id: string;
  approvalItemId: string;
  event: string;
  actor: string;
  meta: unknown | null;
  at: Date;
};

type AuditRow = {
  userId: string | null;
  actor: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  payload: unknown | null;
};

let uid = 0;
const nextId = () => `id-${++uid}`;

function fakePrisma() {
  const items: Row[] = [];
  const events: EventRow[] = [];
  const audit: AuditRow[] = [];
  return {
    _items: items,
    _events: events,
    _audit: audit,
    approvalItem: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const now = new Date();
        const row: Row = {
          id: nextId(),
          userId: data.userId as string,
          kind: data.kind as string,
          payload: data.payload,
          diffJson: data.diffJson,
          state: (data.state as string) ?? 'pending',
          createdAt: now,
          decidedAt: null,
          sentAt: null,
          failedReason: null,
        };
        items.push(row);
        const eventCreate = (data.events as { create?: { event: string; actor?: string; meta?: unknown } } | undefined)
          ?.create;
        if (eventCreate) {
          events.push({
            id: nextId(),
            approvalItemId: row.id,
            event: eventCreate.event,
            actor: eventCreate.actor ?? 'user',
            meta: eventCreate.meta ?? null,
            at: new Date(),
          });
        }
        return { ...row };
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const row = items.find((r) => r.id === where.id);
        if (!row) throw new Error('no such item');
        if (typeof data.state === 'string') row.state = data.state;
        if (data.decidedAt instanceof Date) row.decidedAt = data.decidedAt;
        if (data.sentAt instanceof Date) row.sentAt = data.sentAt;
        if (typeof data.failedReason === 'string') row.failedReason = data.failedReason;
        const eventCreate = (data.events as { create?: { event: string; actor?: string; meta?: unknown } } | undefined)
          ?.create;
        if (eventCreate) {
          events.push({
            id: nextId(),
            approvalItemId: row.id,
            event: eventCreate.event,
            actor: eventCreate.actor ?? 'user',
            meta: eventCreate.meta ?? null,
            at: new Date(),
          });
        }
        return { ...row };
      },
      findFirst: async ({ where }: { where: { id: string; userId?: string } }) => {
        const row = items.find(
          (r) => r.id === where.id && (where.userId ? r.userId === where.userId : true),
        );
        return row ? { ...row } : null;
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = items.find((r) => r.id === where.id);
        return row ? { ...row } : null;
      },
      findMany: async ({
        where,
        orderBy,
        take,
        select,
      }: {
        where?: { id?: { in?: string[] }; userId?: string; state?: string; createdAt?: { lt?: Date } };
        orderBy?: unknown;
        take?: number;
        select?: { kind?: boolean };
      }) => {
        let rows = items.slice();
        if (where?.userId) rows = rows.filter((r) => r.userId === where.userId);
        if (where?.state) rows = rows.filter((r) => r.state === where.state);
        if (where?.id?.in) rows = rows.filter((r) => where.id!.in!.includes(r.id));
        if (where?.createdAt?.lt) rows = rows.filter((r) => r.createdAt < where.createdAt!.lt!);
        if (orderBy) rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        if (typeof take === 'number') rows = rows.slice(0, take);
        if (select?.kind) return rows.map((r) => ({ kind: r.kind }));
        return rows.map((r) => ({ ...r }));
      },
    },
    auditEvent: {
      create: async ({ data }: { data: AuditRow }) => {
        audit.push({ ...data });
        return { id: nextId() };
      },
    },
  };
}

function makeService(overrides: { gate?: SensitivityGate } = {}) {
  const prisma = fakePrisma();
  const gate = overrides.gate ?? new SensitivityGate();
  const svc = new ApprovalsService(prisma as never, gate);
  return { prisma, gate, svc };
}

async function enqueue(
  svc: ApprovalsService,
  userId: string,
  kind: ApprovalKind = 'outreach_email',
): Promise<ApprovalItemDto> {
  return svc.enqueue({
    userId,
    kind,
    payload: { subject: 'hi' },
    diffJson: { subject: 'hi' },
  });
}

beforeEach(() => {
  uid = 0;
});

// -----------------------------------------------------------------------------
// State machine (via service): legal & illegal transitions
// -----------------------------------------------------------------------------

describe('ApprovalsService state machine', () => {
  it('happy path: enqueue -> approve -> markSent walks pending -> approved -> sent', async () => {
    const { svc, prisma } = makeService();
    const item = await enqueue(svc, 'user-1');
    expect(item.state).toBe('pending');
    const approved = await svc.approve({ userId: 'user-1', itemId: item.id });
    expect(approved.state).toBe('approved');
    expect(approved.decidedAt).not.toBeNull();
    const sent = await svc.markSent({ itemId: item.id, meta: { atsId: 'a1' } });
    expect(sent.state).toBe('sent');
    expect(sent.sentAt).not.toBeNull();
    // Audit trail wrote for every step.
    const actions = prisma._audit.map((a) => a.action);
    expect(actions).toEqual(['approval.enqueued', 'approval.approved', 'approval.sent']);
  });

  it('cancel path: pending -> cancelled records reason', async () => {
    const { svc, prisma } = makeService();
    const item = await enqueue(svc, 'user-1');
    const c = await svc.cancel({ userId: 'user-1', itemId: item.id, reason: 'looked shady' });
    expect(c.state).toBe('cancelled');
    const evt = prisma._events.find((e) => e.event === 'approval.cancelled');
    expect(evt?.meta).toEqual({ reason: 'looked shady' });
  });

  it('cancel from sent throws IllegalStateError', async () => {
    const { svc } = makeService();
    const item = await enqueue(svc, 'user-1');
    await svc.approve({ userId: 'user-1', itemId: item.id });
    await svc.markSent({ itemId: item.id });
    await expect(svc.cancel({ userId: 'user-1', itemId: item.id })).rejects.toBeInstanceOf(
      IllegalStateError,
    );
  });

  it('markSent from pending throws IllegalStateError (only approved -> sent legal)', async () => {
    const { svc } = makeService();
    const item = await enqueue(svc, 'user-1');
    await expect(svc.markSent({ itemId: item.id })).rejects.toBeInstanceOf(IllegalStateError);
  });

  it('markFailed from pending throws IllegalStateError', async () => {
    const { svc } = makeService();
    const item = await enqueue(svc, 'user-1');
    await expect(svc.markFailed({ itemId: item.id, reason: 'boom' })).rejects.toBeInstanceOf(
      IllegalStateError,
    );
  });

  it('double-approve throws IllegalStateError (approved -> approved is illegal)', async () => {
    const { svc } = makeService();
    const item = await enqueue(svc, 'user-1');
    await svc.approve({ userId: 'user-1', itemId: item.id });
    await expect(svc.approve({ userId: 'user-1', itemId: item.id })).rejects.toBeInstanceOf(
      IllegalStateError,
    );
  });

  it('rejects unknown kind at enqueue', async () => {
    const { svc } = makeService();
    await expect(
      svc.enqueue({ userId: 'user-1', kind: 'bogus', payload: {}, diffJson: {} }),
    ).rejects.toBeInstanceOf(IllegalStateError);
  });

  it('load-missing throws NotFoundException', async () => {
    const { svc } = makeService();
    await expect(svc.approve({ userId: 'user-1', itemId: 'nope' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

// -----------------------------------------------------------------------------
// Fresh re-auth gate (single-item + kind-based)
// -----------------------------------------------------------------------------

describe('ApprovalsService fresh re-auth (single approve)', () => {
  it('static-gated kind (delete_account) requires reauth', async () => {
    const { svc, gate } = makeService();
    const item = await enqueue(svc, 'user-1', 'delete_account');
    await expect(svc.approve({ userId: 'user-1', itemId: item.id })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    // Now record reauth and approve succeeds.
    gate.withReauthWindow('user-1', APPROVAL_REAUTH_OP);
    const ok = await svc.approve({ userId: 'user-1', itemId: item.id });
    expect(ok.state).toBe('approved');
  });

  it('caller-flagged requiresFreshReauth is honored even for cheap kinds', async () => {
    const { svc } = makeService();
    const item = await enqueue(svc, 'user-1', 'outreach_email');
    await expect(
      svc.approve({ userId: 'user-1', itemId: item.id, requiresFreshReauth: true }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('cheap kind without the flag skips the reauth check entirely', async () => {
    const { svc } = makeService();
    const item = await enqueue(svc, 'user-1', 'outreach_email');
    const ok = await svc.approve({ userId: 'user-1', itemId: item.id });
    expect(ok.state).toBe('approved');
  });
});

// -----------------------------------------------------------------------------
// Bulk threshold
// -----------------------------------------------------------------------------

describe('ApprovalsService bulkApprove', () => {
  it('4 items (threshold=5) with no gated kinds: no reauth required, all approved', async () => {
    const { svc, prisma } = makeService();
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const item = await enqueue(svc, 'user-1', 'outreach_email');
      ids.push(item.id);
    }
    const out = await svc.bulkApprove({ userId: 'user-1', itemIds: ids });
    expect(out.reauthRequired).toBe(false);
    expect(out.approved).toHaveLength(4);
    expect(out.errored).toHaveLength(0);
    expect(
      prisma._audit.filter((a) => a.action === 'approval.bulk_reauth_required'),
    ).toHaveLength(0);
  });

  it('6 items (over threshold) without reauth: throws + audits bulk_reauth_required', async () => {
    const { svc, prisma } = makeService();
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const item = await enqueue(svc, 'user-1', 'outreach_email');
      ids.push(item.id);
    }
    await expect(svc.bulkApprove({ userId: 'user-1', itemIds: ids })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    const audit = prisma._audit.find((a) => a.action === 'approval.bulk_reauth_required');
    expect(audit).toBeDefined();
    expect(audit?.payload).toMatchObject({ count: 6, threshold: 5, bulkOverThreshold: true });
  });

  it('6 items with fresh reauth: all approved, no bulk_reauth_required audit', async () => {
    const { svc, prisma, gate } = makeService();
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const item = await enqueue(svc, 'user-1', 'outreach_email');
      ids.push(item.id);
    }
    gate.withReauthWindow('user-1', APPROVAL_REAUTH_OP);
    const out = await svc.bulkApprove({ userId: 'user-1', itemIds: ids });
    expect(out.approved).toHaveLength(6);
    expect(out.errored).toHaveLength(0);
    expect(
      prisma._audit.filter((a) => a.action === 'approval.bulk_reauth_required'),
    ).toHaveLength(0);
  });

  it('4 items with a delete_account included: static-gated even under threshold', async () => {
    const { svc } = makeService();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const item = await enqueue(svc, 'user-1', 'outreach_email');
      ids.push(item.id);
    }
    const del = await enqueue(svc, 'user-1', 'delete_account');
    ids.push(del.id);
    await expect(svc.bulkApprove({ userId: 'user-1', itemIds: ids })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('mocked hasFreshReauth is invoked with (userId, approval.decide)', async () => {
    // Explicit gate mock to satisfy the "fresh re-auth check integrated
    // (mock hasFreshReauth)" test spec item.
    const gate = new SensitivityGate();
    const spy = vi.spyOn(gate, 'hasFreshReauth').mockReturnValue(true);
    const { svc } = makeService({ gate });
    const item = await enqueue(svc, 'user-9', 'delete_account');
    await svc.approve({ userId: 'user-9', itemId: item.id });
    expect(spy).toHaveBeenCalledWith('user-9', APPROVAL_REAUTH_OP);
  });
});

// -----------------------------------------------------------------------------
// List pagination
// -----------------------------------------------------------------------------

describe('ApprovalsService list pagination', () => {
  it('returns limit+cursor, nextCursor null on last page', async () => {
    const { svc, prisma } = makeService();
    // Seed 7 with distinct createdAt so cursor ordering is deterministic.
    for (let i = 0; i < 7; i++) {
      const item = await enqueue(svc, 'user-1', 'outreach_email');
      // Nudge createdAt so newest is index 6, oldest is index 0.
      const row = prisma._items.find((r) => r.id === item.id)!;
      row.createdAt = new Date(2026, 0, i + 1);
    }
    const page1 = await svc.list({ userId: 'user-1', limit: 3 });
    expect(page1.items).toHaveLength(3);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await svc.list({ userId: 'user-1', limit: 3, cursor: page1.nextCursor });
    expect(page2.items).toHaveLength(3);
    expect(page2.nextCursor).not.toBeNull();
    const page3 = await svc.list({ userId: 'user-1', limit: 3, cursor: page2.nextCursor });
    // 7 rows, 3+3+1 -> last page has 1 item and nextCursor null.
    expect(page3.items).toHaveLength(1);
    expect(page3.nextCursor).toBeNull();
    // Chronological (newest first): first item on page1 > first on page3.
    expect(new Date(page1.items[0].createdAt).getTime()).toBeGreaterThan(
      new Date(page3.items[0].createdAt).getTime(),
    );
  });

  it('filters by state', async () => {
    const { svc } = makeService();
    const a = await enqueue(svc, 'user-1', 'outreach_email');
    await enqueue(svc, 'user-1', 'outreach_email'); // stays pending
    await svc.cancel({ userId: 'user-1', itemId: a.id });
    const cancelled = await svc.list({ userId: 'user-1', state: 'cancelled' });
    expect(cancelled.items.map((i) => i.state)).toEqual(['cancelled']);
    const pending = await svc.list({ userId: 'user-1', state: 'pending' });
    expect(pending.items).toHaveLength(1);
    expect(pending.items[0].state).toBe('pending');
  });

  it('unknown state filter is silently dropped (returns all)', async () => {
    const { svc } = makeService();
    await enqueue(svc, 'user-1', 'outreach_email');
    const out = await svc.list({ userId: 'user-1', state: 'bogus' });
    expect(out.items).toHaveLength(1);
  });
});

// -----------------------------------------------------------------------------
// Worker registration + dispatch
// -----------------------------------------------------------------------------

describe('ApprovalsService worker registration', () => {
  it('registered worker gets onApproved called for matching kind only', async () => {
    const { svc } = makeService();
    const seen: string[] = [];
    const worker: ApprovalsWorker = {
      handles: (kind) => kind === 'ats_submit',
      onApproved: (item) => {
        seen.push(item.id);
      },
    };
    svc.registerWorker(worker);
    const ats = await enqueue(svc, 'user-1', 'ats_submit');
    const email = await enqueue(svc, 'user-1', 'outreach_email');
    await svc.approve({ userId: 'user-1', itemId: ats.id });
    await svc.approve({ userId: 'user-1', itemId: email.id });
    // Give the fire-and-forget dispatch a tick.
    await new Promise((r) => setImmediate(r));
    expect(seen).toEqual([ats.id]);
  });

  it('worker throwing does not break the approve() response', async () => {
    const { svc } = makeService();
    svc.registerWorker({
      handles: () => true,
      onApproved: () => {
        throw new Error('worker exploded');
      },
    });
    const item = await enqueue(svc, 'user-1', 'ats_submit');
    const out = await svc.approve({ userId: 'user-1', itemId: item.id });
    expect(out.state).toBe('approved');
    await new Promise((r) => setImmediate(r));
  });
});
