import { describe, expect, it, vi } from 'vitest';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { SetupController } from './setup.controller';

// argon2 hashing is mocked so the transaction fake stays predictable.
vi.mock('@careeros/auth', () => ({
  hashPassword: async (p: string) => `hash:${p}`,
  verifyPassword: async () => true,
  seal: () => 'sealed',
  unseal: () => null,
}));

function fakeRes(): Response {
  return { append: () => {} } as unknown as Response;
}
function fakeReq(): Request {
  return { headers: {}, ip: '1.1.1.1' } as unknown as Request;
}

function fakeSession() {
  return { write: async () => 'sid-1', read: () => null, requireUserId: () => 'user-1' };
}

function buildController(prismaTx: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>) {
  return new SetupController(
    { getState: async () => ({}), advance: async () => {} } as never,
    { userCount: async () => 0, createUser: async () => ({ id: 'user-1', email: 'a@b.com' }) } as never,
    fakeSession() as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { $transaction: prismaTx } as never,
  );
}

describe('SetupController POST /setup/account (A-M2)', () => {
  it('acquires pg_advisory_xact_lock inside the transaction', async () => {
    const executed: string[] = [];
    const tx = {
      $executeRaw: async (parts: TemplateStringsArray, ...vals: unknown[]) => {
        executed.push(parts.join('?') + '::' + vals.join(','));
      },
      user: {
        count: async () => 0,
        create: async () => ({ id: 'user-1', email: 'a@b.com' }),
      },
    };
    const ctl = buildController(async (fn) => fn(tx));
    await ctl.account({ email: 'a@b.com', password: 'longenoughpassword' } as never, fakeReq(), fakeRes());
    expect(executed[0]).toContain('pg_advisory_xact_lock');
    // MUTATION-SMOKE: comment out the `$executeRaw` line in setup.controller
    // and this test fails.
  });

  it('returns generic 409 on P2002 (does NOT leak "email exists")', async () => {
    const ctl = buildController(async () => {
      throw new Prisma.PrismaClientKnownRequestError('unique violation', {
        code: 'P2002',
        clientVersion: '5.0.0',
      });
    });
    await expect(
      ctl.account({ email: 'a@b.com', password: 'longenoughpassword' } as never, fakeReq(), fakeRes()),
    ).rejects.toBeInstanceOf(ConflictException);
    // The message must not disclose the email or field name.
    try {
      await ctl.account({ email: 'a@b.com', password: 'longenoughpassword' } as never, fakeReq(), fakeRes());
    } catch (e) {
      const msg = (e as ConflictException).message;
      expect(msg.toLowerCase()).not.toContain('email');
      expect(msg.toLowerCase()).not.toContain('a@b.com');
    }
    // MUTATION-SMOKE: replace the catch with a re-throw of the raw P2002 →
    // the test sees "Unique constraint failed on the fields..." leaking the
    // field name and fails.
  });

  it('re-throws ForbiddenException when a user already exists', async () => {
    const tx = {
      $executeRaw: async () => 0,
      user: { count: async () => 1, create: async () => ({}) },
    };
    const ctl = buildController(async (fn) => fn(tx));
    await expect(
      ctl.account({ email: 'a@b.com', password: 'longenoughpassword' } as never, fakeReq(), fakeRes()),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
