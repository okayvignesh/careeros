import { describe, expect, it, vi } from 'vitest';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { AuthController } from './auth.controller';

// argon2 is mocked so the controller test is fast + deterministic.
vi.mock('@careeros/auth', () => ({
  hashPassword: async (p: string) => `hash:${p}`,
  verifyPassword: async () => true,
  seal: () => 'sealed',
  unseal: () => null,
}));

function fakeReq(): Request {
  return { headers: {}, ip: '1.1.1.1' } as unknown as Request;
}
function fakeRes(): Response {
  return {} as unknown as Response;
}
function fakeSession() {
  return {
    write: vi.fn(async () => 'sid-1'),
    read: () => null,
    requireUserId: () => 'user-1',
    clear: vi.fn(),
  };
}

function buildController(auth: { createUser: (...args: unknown[]) => Promise<unknown> }) {
  return new AuthController(auth as never, fakeSession() as never);
}

const body = { email: 'a@b.com', password: 'longenoughpassword', displayName: 'A' } as never;

describe('AuthController POST /auth/sign-up (A-C1 / A-M2)', () => {
  it('returns { id, email } and writes the session on success', async () => {
    const session = fakeSession();
    const ctl = new AuthController(
      { createUser: vi.fn(async () => ({ id: 'user-1', email: 'a@b.com', displayName: 'A' })) } as never,
      session as never,
    );
    const out = await ctl.signUp(body, fakeReq(), fakeRes());
    expect(out).toEqual({ id: 'user-1', email: 'a@b.com' });
    expect(session.write).toHaveBeenCalledWith(expect.anything(), 'user-1', expect.anything());
  });

  it('maps a P2002 unique violation to a generic 409 (no email leak)', async () => {
    const ctl = buildController({
      createUser: async () => {
        throw new Prisma.PrismaClientKnownRequestError('unique violation', {
          code: 'P2002',
          clientVersion: '5.0.0',
        });
      },
    });
    await expect(ctl.signUp(body, fakeReq(), fakeRes())).rejects.toBeInstanceOf(ConflictException);
    try {
      await ctl.signUp(body, fakeReq(), fakeRes());
    } catch (e) {
      const msg = (e as ConflictException).message.toLowerCase();
      expect(msg).not.toContain('email');
      expect(msg).not.toContain('a@b.com');
    }
    // MUTATION-SMOKE: re-throw the raw P2002 and the test sees Prisma's
    // "Unique constraint failed on the fields..." message leaking the field.
  });

  it('propagates ForbiddenException when a user already exists', async () => {
    const ctl = buildController({
      createUser: async () => {
        throw new ForbiddenException('Account already exists. Sign in instead.');
      },
    });
    await expect(ctl.signUp(body, fakeReq(), fakeRes())).rejects.toBeInstanceOf(ForbiddenException);
  });
});
