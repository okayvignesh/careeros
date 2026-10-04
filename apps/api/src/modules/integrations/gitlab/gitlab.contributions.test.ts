import { describe, it, expect, vi } from 'vitest';
import { GitlabService, buildWeeks, levelFor } from './gitlab.service';

describe('levelFor', () => {
  it('maps counts to the 0-4 scale', () => {
    expect(levelFor(0)).toBe(0);
    expect(levelFor(1)).toBe(1);
    expect(levelFor(3)).toBe(2);
    expect(levelFor(6)).toBe(3);
    expect(levelFor(7)).toBe(4);
    expect(levelFor(100)).toBe(4);
  });
});

describe('buildWeeks', () => {
  it('builds Sunday-first weeks and maps counts/levels onto the right day', () => {
    const today = new Date();
    const iso = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
    )
      .toISOString()
      .slice(0, 10);
    const weeks = buildWeeks(new Map([[iso, 7]]));

    expect(weeks.length).toBeGreaterThan(50);
    for (const w of weeks) {
      expect(new Date(`${w.firstDay}T00:00:00Z`).getUTCDay()).toBe(0);
      expect(w.days).toHaveLength(7);
      expect(w.days[0]!.weekday).toBe(0);
    }
    const hit = weeks.flatMap((w) => w.days).find((d) => d.date === iso)!;
    expect(hit.count).toBe(7);
    expect(hit.level).toBe(4);
  });

  it('defaults missing days to zero', () => {
    const weeks = buildWeeks(new Map());
    expect(weeks.flatMap((w) => w.days).every((d) => d.count === 0 && d.level === 0)).toBe(true);
  });
});

describe('GitlabService.getContributions', () => {
  function svc(prisma: unknown) {
    return new GitlabService(prisma as never, {} as never);
  }

  it('returns null when GitLab is not connected', async () => {
    const prisma = { integration: { findUnique: vi.fn(async () => null) } };
    expect(await svc(prisma).getContributions('u')).toBeNull();
  });

  it('returns null when there is no activity', async () => {
    const prisma = {
      integration: { findUnique: vi.fn(async () => ({ status: 'connected', metadata: {} })) },
      $queryRaw: vi.fn(async () => []),
    };
    expect(await svc(prisma).getContributions('u')).toBeNull();
  });

  it('builds a calendar from dated GitLab evidence', async () => {
    const prisma = {
      integration: {
        findUnique: vi.fn(async () => ({ status: 'connected', metadata: { username: 'jane' } })),
      },
      $queryRaw: vi.fn(async () => [
        { d: '2026-10-01', c: BigInt(38) },
        { d: '2026-10-02', c: BigInt(9) },
      ]),
    };
    const cal = await svc(prisma).getContributions('u');
    expect(cal?.totalContributions).toBe(47);
    expect(cal?.login).toBe('jane');
    expect(cal?.weeks.length).toBeGreaterThan(50);
  });
});
