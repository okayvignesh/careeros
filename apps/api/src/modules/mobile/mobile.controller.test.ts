import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { MobileController } from './mobile.controller';

/**
 * B1 (phase 7 mobile): the refresh route is the one place the client sends a
 * refresh token while its 1h access token may already be expired. These tests
 * pin the "refresh token is the authority" contract: a valid access token wins
 * when present, otherwise the stored deviceId from the body is used.
 */
function fakeMobile() {
  return {
    refresh: vi.fn(async (deviceId: string) => ({
      deviceId,
      jwt: 'new.jwt',
      refreshToken: 'new-refresh',
      expiresAt: new Date(),
    })),
  };
}

function controller(mobile: ReturnType<typeof fakeMobile>) {
  return new MobileController(mobile as never, {} as never, {} as never);
}

describe('MobileController.refresh', () => {
  it('uses the deviceId from the body when the access token is absent/expired', async () => {
    const mobile = fakeMobile();
    const req = { mobileAuth: undefined } as never;
    const out = await controller(mobile).refresh(req, {
      refreshToken: 'r',
      deviceId: 'dev-1',
    });
    expect(mobile.refresh).toHaveBeenCalledWith('dev-1', 'r');
    expect(out.jwt).toBe('new.jwt');
  });

  it('prefers the middleware-verified deviceId when an access token is live', async () => {
    const mobile = fakeMobile();
    const req = { mobileAuth: { deviceId: 'verified' } } as never;
    await controller(mobile).refresh(req, { refreshToken: 'r', deviceId: 'spoofed' });
    expect(mobile.refresh).toHaveBeenCalledWith('verified', 'r');
  });

  it('requires a deviceId', async () => {
    const mobile = fakeMobile();
    await expect(
      controller(mobile).refresh({ mobileAuth: undefined } as never, { refreshToken: 'r' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(mobile.refresh).not.toHaveBeenCalled();
  });

  it('requires a refreshToken', async () => {
    const mobile = fakeMobile();
    await expect(
      controller(mobile).refresh({ mobileAuth: { deviceId: 'd' } } as never, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mobile.refresh).not.toHaveBeenCalled();
  });
});
