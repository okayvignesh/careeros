import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { RequireAdminGuard } from './require-admin.guard';

// C-P3.8a: RequireAdminGuard behaviour matrix.
// Single-user MVP: guard always allows the sole authenticated user (the
// deployment IS the admin). Multi-user: fall back to `user.isAdmin === true`.
// Unauth requests fail 401 (indistinguishable from any other authed route).
//
// Mutation smoke lives inline: each assertion names the mutation it catches.

const USER_ID = '00000000-0000-0000-0000-000000000001';

function makeCtx(cookie: string): ExecutionContext {
  const req = { headers: { cookie } };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function makeGuard(opts: {
  sessionResult: { userId: string } | null;
  userCount: number;
  user?: { id: string; isAdmin?: boolean } | null;
}) {
  const session = { read: vi.fn(() => opts.sessionResult) };
  const prisma = {
    user: {
      count: vi.fn(async () => opts.userCount),
      findUnique: vi.fn(async () => opts.user ?? null),
    },
  };
  const guard = new RequireAdminGuard(session as never, prisma as never);
  return { guard, session, prisma };
}

describe('RequireAdminGuard', () => {
  it('rejects unauthenticated with 401 (never 403)', async () => {
    const { guard } = makeGuard({ sessionResult: null, userCount: 1 });
    await expect(guard.canActivate(makeCtx(''))).rejects.toBeInstanceOf(UnauthorizedException);
    // MUTATION SMOKE: swap the throw to `return false` → Nest turns it into
    // 403; the .toBeInstanceOf(UnauthorizedException) assertion fails.
  });

  it('single-user (count=1): allows the sole authenticated user', async () => {
    const { guard, prisma } = makeGuard({
      sessionResult: { userId: USER_ID },
      userCount: 1,
    });
    await expect(guard.canActivate(makeCtx('c=1'))).resolves.toBe(true);
    // Short-circuits before any User lookup.
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    // MUTATION SMOKE: change `userCount <= 1` to `userCount < 1` → the single
    // user hits the multi-user path, findUnique gets called (returns null,
    // no isAdmin) → 403 → .resolves.toBe(true) fails.
  });

  it('zero users (count=0): still allows (guard is not the auth check)', async () => {
    // Defensive: `count === 0` shouldn't happen post-setup, but if it does
    // (e.g. wiped DB) the guard should not add a second layer of gating.
    const { guard } = makeGuard({ sessionResult: { userId: USER_ID }, userCount: 0 });
    await expect(guard.canActivate(makeCtx('c=1'))).resolves.toBe(true);
  });

  it('multi-user (count=2) + isAdmin=false: rejects with 403', async () => {
    const { guard } = makeGuard({
      sessionResult: { userId: USER_ID },
      userCount: 2,
      user: { id: USER_ID, isAdmin: false },
    });
    await expect(guard.canActivate(makeCtx('c=1'))).rejects.toBeInstanceOf(ForbiddenException);
    // MUTATION SMOKE: flip the fallback to `return true` unconditionally →
    // this assertion fails.
  });

  it('multi-user (count=2) + isAdmin=true: allows', async () => {
    const { guard } = makeGuard({
      sessionResult: { userId: USER_ID },
      userCount: 2,
      user: { id: USER_ID, isAdmin: true },
    });
    await expect(guard.canActivate(makeCtx('c=1'))).resolves.toBe(true);
    // MUTATION SMOKE: drop the `=== true` narrowing (accept any truthy) →
    // still passes here, but flip to `!== true` → this fails.
  });

  it('multi-user (count=2) + missing user row: rejects with 403', async () => {
    // isAdmin field not yet migrated → findUnique returns null (or a User with
    // no isAdmin key). Either way the fallback must refuse.
    const { guard } = makeGuard({
      sessionResult: { userId: USER_ID },
      userCount: 2,
      user: null,
    });
    await expect(guard.canActivate(makeCtx('c=1'))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('multi-user (count=2) + User has no isAdmin field: rejects with 403', async () => {
    // Simulates the current schema state: no `isAdmin` column on the User row.
    const { guard } = makeGuard({
      sessionResult: { userId: USER_ID },
      userCount: 2,
      user: { id: USER_ID }, // no isAdmin key
    });
    await expect(guard.canActivate(makeCtx('c=1'))).rejects.toBeInstanceOf(ForbiddenException);
    // MUTATION SMOKE: change the check to `!== false` → an absent field is
    // NOT false, so the guard would allow → this fails.
  });
});
