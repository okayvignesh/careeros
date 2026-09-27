import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { RejectLogController } from './reject-log.controller';

// C-P3.2e: pagination + re-verify happy-path coverage. RequireAdmin guard is
// verified separately in require-admin.guard.test (C-P3.8a), so this suite
// exercises the controller body only, with hand-rolled prisma / session doubles.

const req = {} as Request;

function build(opts: {
  rows?: unknown[];
  total?: number;
  detail?: unknown | null;
  upsertResult?: { id: string };
} = {}) {
  const rows = opts.rows ?? [];
  const total = opts.total ?? rows.length;
  const findManyMock = vi.fn(async () => rows);
  const countMock = vi.fn(async () => total);
  const findUniqueMock = vi.fn(async () => opts.detail ?? null);
  const upsertMock = vi.fn(async () => opts.upsertResult ?? { id: 'nj-new' });
  const updateMock = vi.fn(async () => ({}));
  const prisma = {
    jobRejectLog: {
      findMany: findManyMock,
      count: countMock,
      findUnique: findUniqueMock,
      update: updateMock,
    },
    normalizedJob: {
      upsert: upsertMock,
    },
  };
  const session = { requireUserId: vi.fn(() => 'user-1') };
  const controller = new RejectLogController(prisma as never, session as never);
  return { controller, prisma, session, findManyMock, countMock, findUniqueMock, upsertMock, updateMock };
}

describe('RejectLogController — GET /admin/jobs/reject-log (pagination)', () => {
  it('returns paginated rows + total with default limit=50 offset=0', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: `r-${i}`,
      jobRawId: null,
      sourceId: `s-${i}`,
      sourceName: 'remotive',
      rejectedAt: new Date(),
      reason: 'stale',
      verdict: 'rejected',
    }));
    const h = build({ rows, total: 3 });
    const out = await h.controller.list(undefined, undefined, undefined, undefined, req);
    // MUTATION SMOKE: swap `parsedLimit` for a hardcoded 10 → still 3 rows so
    // test survives; but the take-arg assertion below fails.
    expect(out.total).toBe(3);
    expect(out.rows).toHaveLength(3);
    expect(out.offset).toBe(0);
    expect(out.limit).toBe(50);
    const findManyCall = (h.findManyMock.mock.calls[0] as unknown as [{ take: number; skip: number; where: Record<string, unknown> }])[0];
    expect(findManyCall.take).toBe(50);
    expect(findManyCall.skip).toBe(0);
    expect(findManyCall.where).toEqual({});
  });

  it('honors ?limit + ?offset', async () => {
    const h = build({ rows: [], total: 100 });
    await h.controller.list('20', '40', undefined, undefined, req);
    const c = (h.findManyMock.mock.calls[0] as unknown as [{ take: number; skip: number }])[0];
    // MUTATION SMOKE: ignore ?offset → skip stays 0, this fails.
    expect(c.take).toBe(20);
    expect(c.skip).toBe(40);
  });

  it('rejects limit > 200 with 400', async () => {
    const h = build();
    await expect(
      h.controller.list('500', undefined, undefined, undefined, req),
    ).rejects.toBeInstanceOf(BadRequestException);
    // MUTATION SMOKE: raise cap to 1000 → this fails.
    expect(h.findManyMock).not.toHaveBeenCalled();
  });

  it('rejects negative offset with 400', async () => {
    const h = build();
    await expect(
      h.controller.list(undefined, '-5', undefined, undefined, req),
    ).rejects.toBeInstanceOf(BadRequestException);
    // MUTATION SMOKE: drop the >= 0 check → this fails.
    expect(h.findManyMock).not.toHaveBeenCalled();
  });

  it('threads ?reason + ?adapter into the where clause', async () => {
    const h = build({ rows: [], total: 0 });
    await h.controller.list(undefined, undefined, 'stale', 'remotive', req);
    const c = (h.findManyMock.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0];
    // MUTATION SMOKE: swap the two field names → this fails.
    expect(c.where).toEqual({ reason: 'stale', sourceName: 'remotive' });
  });

  it('ignores blank reason/adapter filters', async () => {
    const h = build({ rows: [], total: 0 });
    await h.controller.list(undefined, undefined, '   ', '', req);
    const c = (h.findManyMock.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0];
    // MUTATION SMOKE: pass empty strings straight through → this fails.
    expect(c.where).toEqual({});
  });
});

describe('RejectLogController — GET /admin/jobs/reject-log/:id', () => {
  it('404s when the row is missing', async () => {
    const h = build({ detail: null });
    // MUTATION SMOKE: return an empty object instead of null → NotFoundException never fires, this fails.
    await expect(h.controller.detail('missing', req)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns full row when found', async () => {
    const row = { id: 'r-1', sourceId: 's', sourceName: 'remotive', reason: 'stale', details: {} };
    const h = build({ detail: row });
    const out = await h.controller.detail('r-1', req);
    // MUTATION SMOKE: return `{}` regardless → this fails.
    expect(out).toBe(row);
  });
});

describe('RejectLogController — POST /admin/jobs/reject-log/:id/re-verify', () => {
  const fresh = new Date().toISOString(); // fresh enough to pass verify's stale check.
  const goodDetails = {
    reasons: ['stale'],
    canonicalUrl: 'https://ex.com/j/1',
    title: 'Senior Backend Engineer Role',
    company: 'Acme Inc',
    rawJd:
      'We are hiring a senior backend engineer to build our distributed platform. Node.js and PostgreSQL required.',
    sourcePostedAt: fresh,
  };

  it('404s when the reject-log entry does not exist', async () => {
    const h = build({ detail: null });
    // MUTATION SMOKE: skip the null check → prisma.normalizedJob.upsert would throw, but this fails first.
    await expect(h.controller.reVerify('missing', req)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('happy path: fresh JD → verdict flips, promotes into jobs_normalized', async () => {
    const h = build({
      detail: {
        id: 'r-1',
        sourceId: 'src-1',
        sourceName: 'remotive',
        details: goodDetails,
      },
      upsertResult: { id: 'nj-42' },
    });
    const out = (await h.controller.reVerify('r-1', req)) as { promoted: boolean; normalizedJobId?: string; verdict: string };
    // MUTATION SMOKE: keep verdict='rejected' hardcoded regardless → 'promoted:true' expectation fails.
    expect(out.promoted).toBe(true);
    expect(out.normalizedJobId).toBe('nj-42');
    // MUTATION SMOKE: skip the prisma upsert call → this fails.
    expect(h.upsertMock).toHaveBeenCalledTimes(1);
    // Reject-log row preserved + annotated with promotion trace.
    expect(h.updateMock).toHaveBeenCalledTimes(1);
    const updateArg = (h.updateMock.mock.calls[0] as unknown as [{ data: { details: Record<string, unknown> } }])[0];
    expect(updateArg.data.details.promotedTo).toBe('nj-42');
    expect(updateArg.data.details.promotedVerdict).toMatch(/^(trusted|flagged)$/);
  });

  it('re-verify with still-rejecting JD returns promoted=false, no upsert', async () => {
    const staleJd = { ...goodDetails, rawJd: 'x', sourcePostedAt: new Date(0).toISOString() };
    const h = build({
      detail: {
        id: 'r-1',
        sourceId: 'src-1',
        sourceName: 'remotive',
        details: staleJd,
      },
    });
    const out = (await h.controller.reVerify('r-1', req)) as { promoted: boolean; verdict: string; reasons: string[] };
    // MUTATION SMOKE: unconditionally return `{promoted:true}` → this fails.
    expect(out.promoted).toBe(false);
    expect(out.verdict).toBe('rejected');
    expect(out.reasons.length).toBeGreaterThan(0);
    expect(h.upsertMock).not.toHaveBeenCalled();
    expect(h.updateMock).not.toHaveBeenCalled();
  });

  it('400s when details blob is missing required fields', async () => {
    const h = build({
      detail: {
        id: 'r-1',
        sourceId: 'src-1',
        sourceName: 'remotive',
        details: { rawJd: 'x' }, // no canonicalUrl / title / company
      },
    });
    // MUTATION SMOKE: coerce missing fields with String(undefined) === 'undefined' → the truthy check
    // passes and this fails.
    await expect(h.controller.reVerify('r-1', req)).rejects.toBeInstanceOf(BadRequestException);
    expect(h.upsertMock).not.toHaveBeenCalled();
  });
});
