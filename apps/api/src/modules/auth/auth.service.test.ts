import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthService, LockoutError, lockoutSecondsFor, normalizeEmail } from './auth.service';

// Argon2 verify path is mocked so the tests are fast + deterministic. The
// real hashPassword/verifyPassword contract lives in packages/auth tests.
vi.mock('@careeros/auth', () => ({
  hashPassword: async (p: string) => `hash:${p}`,
  verifyPassword: async (hash: string, p: string) => hash === `hash:${p}`,
}));

// --- A-C1 pure helper coverage ---

describe('A-C1 lockoutSecondsFor', () => {
  it('is 0 with no failures', () => {
    expect(lockoutSecondsFor(0)).toBe(0);
    expect(lockoutSecondsFor(-1)).toBe(0);
  });
  it('is 2^(N-1) below the cap', () => {
    expect(lockoutSecondsFor(1)).toBe(1);
    expect(lockoutSecondsFor(2)).toBe(2);
    expect(lockoutSecondsFor(5)).toBe(16);
    expect(lockoutSecondsFor(9)).toBe(256);
  });
  it('caps at 15 min', () => {
    expect(lockoutSecondsFor(11)).toBe(900);
    expect(lockoutSecondsFor(50)).toBe(900);
  });
  // MUTATION-SMOKE: swapping `2 ** (N-1)` for `2 ** N` breaks all three
  // exponent assertions above → any regression is caught immediately.
});

describe('normalizeEmail (A-L2 assist)', () => {
  it('lowercases + NFC-normalizes', () => {
    // Composed vs decomposed é — same bucket after NFC.
    const composed = 'Café@example.com';
    const decomposed = 'CAFÉ@example.com';
    expect(normalizeEmail(composed)).toBe(normalizeEmail(decomposed));
  });
});

// --- A-C1 lockout integration (Prisma fake) ---

type Attempt = { email: string; ip: string; ok: boolean; reason?: string | null; attemptedAt: Date };

function fakePrisma(userExists: boolean, opts?: { seed?: Attempt[] }) {
  const attempts: Attempt[] = opts?.seed ?? [];
  const audits: Array<{ action: string; payload: unknown }> = [];
  return {
    calls: { attempts, audits },
    user: {
      findUnique: async () =>
        userExists ? { id: 'user-1', email: 'a@b.com', passwordHash: 'hash:right' } : null,
      count: async () => (userExists ? 1 : 0),
      create: async () => ({ id: 'user-1', email: 'a@b.com', displayName: null }),
      update: async () => ({}),
    },
    loginAttempt: {
      create: async ({ data }: { data: Omit<Attempt, 'attemptedAt'> & { attemptedAt?: Date } }) => {
        attempts.push({ ...data, attemptedAt: data.attemptedAt ?? new Date() });
        return {};
      },
      findFirst: async ({
        where,
        orderBy: _orderBy,
      }: {
        where: { email: string; ip: string; ok: boolean; attemptedAt?: { gte?: Date; gt?: Date } };
        orderBy?: unknown;
      }) => {
        const rows = attempts
          .filter((a) => a.email === where.email && a.ip === where.ip && a.ok === where.ok)
          .filter((a) => {
            const gte = where.attemptedAt?.gte;
            const gt = where.attemptedAt?.gt;
            if (gte && a.attemptedAt.getTime() < gte.getTime()) return false;
            if (gt && a.attemptedAt.getTime() <= gt.getTime()) return false;
            return true;
          })
          .sort((a, b) => b.attemptedAt.getTime() - a.attemptedAt.getTime());
        return rows[0] ?? null;
      },
      count: async ({
        where,
      }: {
        where: { email: string; ip: string; ok: boolean; attemptedAt?: { gte?: Date; gt?: Date } };
      }) => {
        return attempts.filter((a) => {
          if (a.email !== where.email || a.ip !== where.ip || a.ok !== where.ok) return false;
          const gte = where.attemptedAt?.gte;
          const gt = where.attemptedAt?.gt;
          if (gte && a.attemptedAt.getTime() < gte.getTime()) return false;
          if (gt && a.attemptedAt.getTime() <= gt.getTime()) return false;
          return true;
        }).length;
      },
    },
    auditEvent: {
      create: async ({ data }: { data: { action: string; payload: unknown } }) => {
        audits.push({ action: data.action, payload: data.payload });
        return {};
      },
    },
  };
}

describe('AuthService.verifyCredentialsWithLockout (A-C1)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('lets a correct password through on a clean history', async () => {
    const prisma = fakePrisma(true);
    const svc = new AuthService(prisma as never);
    const u = await svc.verifyCredentialsWithLockout('a@b.com', 'right', '1.1.1.1');
    expect(u.id).toBe('user-1');
    // One success row appended, no audit lockout.
    expect(prisma.calls.attempts.some((a) => a.ok)).toBe(true);
    expect(prisma.calls.audits).toHaveLength(0);
  });

  it('locks subsequent attempts after the first failure (exponential from N=1)', async () => {
    const prisma = fakePrisma(true);
    const svc = new AuthService(prisma as never);
    // 1st attempt: no prior history → argon2 runs → wrong → Unauthorized.
    await expect(svc.verifyCredentialsWithLockout('a@b.com', 'wrong', '2.2.2.2')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    // 2nd attempt: failures=1 → lockoutSecondsFor(1)=1s; elapsed<1s in tests →
    // LockoutError (spec: min(2^(N-1),900)).
    await expect(svc.verifyCredentialsWithLockout('a@b.com', 'right', '2.2.2.2')).rejects.toBeInstanceOf(
      LockoutError,
    );
    // MUTATION-SMOKE: comment out the `throw new LockoutError(...)` block in
    // verifyCredentialsWithLockout and the 2nd attempt returns success →
    // this test catches it.
  });

  it('records exactly one lockout audit event at the 5-failure threshold', async () => {
    // Seed 4 prior failures dated far enough back that we are NOT rate-locked
    // out but the window still counts them. Then one more wrong attempt makes
    // it 5 and fires the audit.
    const now = Date.now();
    const seed: Attempt[] = [1, 2, 3, 4].map((i) => ({
      email: 'a@b.com',
      ip: '4.4.4.4',
      ok: false,
      reason: 'invalid_credentials',
      attemptedAt: new Date(now - 60_000 - i * 1000), // 61-64s ago, but under the 15-min window
    }));
    const prisma = fakePrisma(true, { seed });
    const svc = new AuthService(prisma as never);
    // The most-recent seeded failure is ~61s ago; lockoutSecondsFor(4)=8, so
    // elapsed >> 8, no active lock → argon2 runs → wrong → 5th failure.
    await expect(svc.verifyCredentialsWithLockout('a@b.com', 'wrong', '4.4.4.4')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.calls.audits.filter((a) => a.action === 'auth.login.lockout')).toHaveLength(1);
  });

  it('resets the counter on the next successful attempt', async () => {
    const prisma = fakePrisma(true, {
      seed: [
        { email: 'a@b.com', ip: '3.3.3.3', ok: false, reason: 'invalid_credentials', attemptedAt: new Date(Date.now() - 20_000) },
        { email: 'a@b.com', ip: '3.3.3.3', ok: true, reason: null, attemptedAt: new Date(Date.now() - 10_000) },
      ],
    });
    const svc = new AuthService(prisma as never);
    // With a recent success on record, we should NOT be locked out despite
    // the earlier failure.
    const u = await svc.verifyCredentialsWithLockout('a@b.com', 'right', '3.3.3.3');
    expect(u.id).toBe('user-1');
  });
});

// --- A-H3 password change / revocation ---

describe('AuthService.changePassword (A-H3)', () => {
  it('verifies old password, revokes all sessions, writes audit', async () => {
    const deleted: unknown[] = [];
    const updates: unknown[] = [];
    const audits: unknown[] = [];
    const prisma = {
      user: {
        findUnique: async () => ({ passwordHash: 'hash:old', email: 'a@b.com' }),
        update: async (args: unknown) => {
          updates.push(args);
          return {};
        },
      },
      activeSession: {
        deleteMany: async (args: unknown) => {
          deleted.push(args);
          return { count: 3 };
        },
      },
      auditEvent: {
        create: async (args: { data: unknown }) => {
          audits.push(args.data);
          return {};
        },
      },
      // Emulate $transaction([...]) → run promises in array order.
      $transaction: async (arr: unknown[]) => Promise.all(arr as Promise<unknown>[]),
    };
    const svc = new AuthService(prisma as never);
    await svc.changePassword('user-1', 'old', 'a-brand-new-password');
    expect(updates).toHaveLength(1);
    expect(deleted).toHaveLength(1);
    expect(audits).toHaveLength(1);
    // A-H3: assert the audit shape, not just presence; a mutation that swaps
    // the action string ('auth.password.changed' → anything) must be caught.
    expect(audits[0]).toMatchObject({
      userId: 'user-1',
      actor: 'user',
      action: 'auth.password.changed',
      resourceType: 'user',
      resourceId: 'user-1',
    });
    // MUTATION-SMOKE: remove the `activeSession.deleteMany` line from
    // changePassword and this test's `deleted` assertion fails; change the
    // action string and the toMatchObject fails.
  });

  it('refuses when the current password is wrong', async () => {
    const prisma = {
      user: {
        findUnique: async () => ({ passwordHash: 'hash:something-else', email: 'a@b.com' }),
        update: async () => ({}),
      },
      activeSession: { deleteMany: async () => ({ count: 0 }) },
      auditEvent: { create: async () => ({}) },
      $transaction: async (arr: unknown[]) => Promise.all(arr as Promise<unknown>[]),
    };
    const svc = new AuthService(prisma as never);
    await expect(svc.changePassword('user-1', 'wrong-guess', 'a-brand-new-password')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a new password shorter than 12 chars', async () => {
    const prisma = {
      user: { findUnique: async () => ({ passwordHash: 'hash:old', email: 'a@b.com' }) },
      activeSession: { deleteMany: async () => ({ count: 0 }) },
      auditEvent: { create: async () => ({}) },
      $transaction: async (arr: unknown[]) => Promise.all(arr as Promise<unknown>[]),
    };
    const svc = new AuthService(prisma as never);
    await expect(svc.changePassword('user-1', 'old', 'short')).rejects.toThrow(/short/i);
  });
});

// --- A-C1/A-M2 single-user sign-up lock ---

/**
 * Emulates `pg_advisory_xact_lock`: the lock is held only while a transaction
 * that called `$executeRaw` is running. If production drops the lock, both
 * transactions overlap and both observe `count() === 0` → two users created.
 */
function advisoryLockPrisma(users: Array<{ id: string; email: string }>) {
  let held = false;
  const waiters: Array<() => void> = [];
  const acquire = () =>
    new Promise<void>((resolve) => {
      if (!held) {
        held = true;
        resolve();
        return;
      }
      waiters.push(() => {
        held = true;
        resolve();
      });
    });
  const release = () => {
    const next = waiters.shift();
    if (next) next();
    else held = false;
  };

  const base = {
    user: {
      count: async () => users.length,
      create: async ({ data }: { data: { email: string } }) => {
        const user = { id: `user-${users.length + 1}`, email: data.email };
        users.push(user);
        return user;
      },
    },
  };

  return {
    users,
    $transaction: async <T>(
      fn: (tx: typeof base & { $executeRaw: () => Promise<void> }) => Promise<T>,
    ): Promise<T> => {
      let acquired = false;
      const tx = {
        ...base,
        $executeRaw: async () => {
          acquired = true;
          await acquire();
        },
      };
      try {
        return await fn(tx);
      } finally {
        if (acquired) release();
      }
    },
  };
}

describe('AuthService.createUser (single-user advisory lock)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('serializes concurrent sign-ups so only the first user is created', async () => {
    const prisma = advisoryLockPrisma([]);
    const svc = new AuthService(prisma as never);
    const results = await Promise.allSettled([
      svc.createUser('a@b.com', 'pw-a-long-enough', 'A'),
      svc.createUser('c@d.com', 'pw-c-long-enough', 'C'),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ForbiddenException);
    expect(prisma.users).toHaveLength(1);
    // MUTATION-SMOKE: remove the `$executeRaw(... pg_advisory_xact_lock ...)`
    // line from AuthService.createUser and both transactions run concurrently
    // → both see count=0 → `users` has 2 rows and this test fails.
  });

  it('acquires the shared first-account advisory lock inside the transaction', async () => {
    const seen: string[] = [];
    const users: Array<{ id: string; email: string }> = [];
    const prisma = {
      user: {
        count: async () => users.length,
        create: async ({ data }: { data: { email: string } }) => {
          const u = { id: 'user-1', email: data.email };
          users.push(u);
          return u;
        },
      },
      $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
        fn({
          $executeRaw: async (parts: TemplateStringsArray) => {
            seen.push(parts.join('?'));
          },
          user: {
            count: async () => users.length,
            create: async ({ data }: { data: { email: string } }) => {
              const u = { id: 'user-1', email: data.email };
              users.push(u);
              return u;
            },
          },
        }),
    };
    const svc = new AuthService(prisma as never);
    await svc.createUser('a@b.com', 'pw-a-long-enough', 'A');
    expect(seen[0]).toContain('pg_advisory_xact_lock');
  });
});
