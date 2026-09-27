import { describe, expect, it } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { SnapshotController } from './snapshot.controller';
import type { MarketSnapshotRow, TrendDiff } from './snapshot.service';

// C-P3.4c: shape + 401 contract on all four snapshot endpoints. We stub the
// session, snapshots, and prefs services directly - the controller is a thin
// wire that calls session.requireUserId + delegates. Business logic lives in
// snapshot.service.test.ts.

const req = {} as unknown as Request;

function makeStubs(opts: {
  authed?: boolean;
  latest?: MarketSnapshotRow | null;
  trend?: TrendDiff;
  history?: MarketSnapshotRow[];
} = {}) {
  const calls: {
    writeSnapshot: unknown[];
    latest: unknown[];
    trend: unknown[];
    history: unknown[];
  } = { writeSnapshot: [], latest: [], trend: [], history: [] };
  const session = {
    requireUserId: () => {
      if (opts.authed === false) throw new UnauthorizedException('Not signed in');
      return 'user-1';
    },
  };
  const snapshots = {
    writeSnapshot: async (userId: string, filter: unknown, source: string) => {
      calls.writeSnapshot.push({ userId, filter, source });
      return {
        id: 'snap-1',
        userId,
        snapshotAt: '2026-09-27T06:00:00.000Z',
        filterHash: 'deadbeef',
        createdBy: source,
        stats: {
          windowDays: 7,
          totalCount: 5,
          newCount: 3,
          remoteShare: 0.6,
          topSkills: [],
          topCompanies: [],
        },
      } as MarketSnapshotRow;
    },
    latestForUser: async (userId: string) => {
      calls.latest.push(userId);
      return opts.latest === undefined ? null : opts.latest;
    },
    diffAgainstLastWeek: async (userId: string) => {
      calls.trend.push(userId);
      return (
        opts.trend ?? {
          hasComparison: false,
          reason: 'no snapshot yet',
          postingsDelta: { absolute: 0, percent: 0 },
          remoteShareDelta: 0,
          medianCompDelta: 0,
          topSkillsAdded: [],
          topSkillsRemoved: [],
          topSkillsRankChange: [],
          newCompanies: [],
        }
      );
    },
    historyForUser: async (userId: string, weeks: number) => {
      calls.history.push({ userId, weeks });
      return opts.history ?? [];
    },
  };
  const prefs = {
    get: async () => ({
      targetRoles: [],
      locations: [],
      remoteOnly: false,
      currency: 'USD' as const,
      seniority: [] as string[],
      mustHaveSkills: [] as string[],
      dealbreakerSkills: [] as string[],
      companyBlacklist: [] as string[],
      updatedAt: null,
    }),
  };
  const controller = new SnapshotController(snapshots as never, prefs as never, session as never);
  return { controller, calls };
}

// -----------------------------------------------------------------------------
// 401 on every route when unauthenticated
// -----------------------------------------------------------------------------

describe('SnapshotController 401 contract', () => {
  it('POST / -> 401 when session.requireUserId throws', async () => {
    const { controller } = makeStubs({ authed: false });
    await expect(controller.manual(req)).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('GET /latest -> 401', async () => {
    const { controller } = makeStubs({ authed: false });
    await expect(controller.latest(req)).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('GET /trend -> 401', async () => {
    const { controller } = makeStubs({ authed: false });
    await expect(controller.trend(req)).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('GET /history -> 401', async () => {
    const { controller } = makeStubs({ authed: false });
    await expect(controller.history(req)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

// -----------------------------------------------------------------------------
// Happy-path shape
// -----------------------------------------------------------------------------

describe('SnapshotController happy path', () => {
  it('POST / writes with source="manual" for the authed user', async () => {
    const { controller, calls } = makeStubs();
    const row = await controller.manual(req);
    expect(calls.writeSnapshot).toHaveLength(1);
    expect((calls.writeSnapshot[0] as { userId: string; source: string }).userId).toBe('user-1');
    expect((calls.writeSnapshot[0] as { source: string }).source).toBe('manual');
    expect(row.id).toBe('snap-1');
    expect(row.createdBy).toBe('manual');
  });

  it('GET /latest returns { empty: true } when nothing exists', async () => {
    const { controller } = makeStubs({ latest: null });
    const out = await controller.latest(req);
    expect(out).toEqual({ empty: true });
  });

  it('GET /latest returns the row when it exists', async () => {
    const row: MarketSnapshotRow = {
      id: 'snap-2',
      userId: 'user-1',
      snapshotAt: '2026-09-27T06:00:00.000Z',
      filterHash: 'abc',
      createdBy: 'cron',
      stats: {
        windowDays: 7,
        totalCount: 42,
        newCount: 10,
        remoteShare: 0.5,
        topSkills: [],
        topCompanies: [],
      },
    };
    const { controller } = makeStubs({ latest: row });
    const out = await controller.latest(req);
    expect(out).toEqual(row);
  });

  it('GET /trend delegates to diffAgainstLastWeek', async () => {
    const diff: TrendDiff = {
      hasComparison: true,
      from: { snapshotAt: 'a', snapshotId: 'x' },
      to: { snapshotAt: 'b', snapshotId: 'y' },
      postingsDelta: { absolute: 5, percent: 0.1 },
      remoteShareDelta: 0.05,
      medianCompDelta: 0,
      topSkillsAdded: ['rust'],
      topSkillsRemoved: [],
      topSkillsRankChange: [],
      newCompanies: ['Wayne'],
    };
    const { controller, calls } = makeStubs({ trend: diff });
    const out = await controller.trend(req);
    expect(out).toEqual(diff);
    expect(calls.trend).toEqual(['user-1']);
  });

  it('GET /history defaults weeks to 12 and wraps items[]', async () => {
    const { controller, calls } = makeStubs({ history: [] });
    const out = await controller.history(req);
    expect(out).toEqual({ items: [] });
    expect(calls.history).toEqual([{ userId: 'user-1', weeks: 12 }]);
  });

  it('GET /history?weeks=6 forwards the parsed value', async () => {
    const { controller, calls } = makeStubs({ history: [] });
    await controller.history(req, '6');
    expect(calls.history).toEqual([{ userId: 'user-1', weeks: 6 }]);
  });

  it('GET /history?weeks=notanumber falls back to 12', async () => {
    const { controller, calls } = makeStubs({ history: [] });
    await controller.history(req, 'notanumber');
    expect(calls.history).toEqual([{ userId: 'user-1', weeks: 12 }]);
  });

  // MUTATION SMOKE:
  //  * drop the `requireUserId` call and every 401 test fails.
  //  * flip the source arg to 'cron' in manual() and the "manual" assertion fails.
});
