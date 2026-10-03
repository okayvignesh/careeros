import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { ApprovalsController } from './approvals.controller';
import { APPROVAL_REAUTH_OP } from './state-machine';

const req = { headers: {}, ip: '127.0.0.1' } as unknown as Request;

function build() {
  const session = { requireUserId: vi.fn(() => 'user-1') };
  const prisma = { user: { findUnique: vi.fn(async () => ({ email: 'me@test.local' })) } };
  const auth = { verifyCredentialsWithLockout: vi.fn(async () => ({ id: 'user-1', email: 'me@test.local' })) };
  const gate = { withReauthWindow: vi.fn(() => ({ expiresAt: 123 })) };
  const controller = new ApprovalsController(
    {} as never,
    session as never,
    prisma as never,
    auth as never,
    gate as never,
  );
  return { controller, auth, gate, prisma };
}

describe('ApprovalsController.reauth', () => {
  it('verifies the password then mints a fresh approval.decide window', async () => {
    const { controller, auth, gate } = build();
    const out = await controller.reauth({ password: 'correct horse' }, req);
    expect(auth.verifyCredentialsWithLockout).toHaveBeenCalledWith('me@test.local', 'correct horse', expect.any(String));
    expect(gate.withReauthWindow).toHaveBeenCalledWith('user-1', APPROVAL_REAUTH_OP);
    expect(out).toEqual({ expiresAt: 123 });
  });

  it('rejects a missing password without verifying', async () => {
    const { controller, auth, gate } = build();
    await expect(controller.reauth({}, req)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.reauth({ password: '' }, req)).rejects.toBeInstanceOf(BadRequestException);
    expect(auth.verifyCredentialsWithLockout).not.toHaveBeenCalled();
    expect(gate.withReauthWindow).not.toHaveBeenCalled();
  });

  it('does not mint a window when the password is wrong', async () => {
    const { controller, auth, gate } = build();
    auth.verifyCredentialsWithLockout.mockRejectedValueOnce(new UnauthorizedException('Invalid email or password'));
    await expect(controller.reauth({ password: 'nope' }, req)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(gate.withReauthWindow).not.toHaveBeenCalled();
  });
});
