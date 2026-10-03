import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { MOBILE_JWT_SCOPE, MobileService } from './mobile.service';

/**
 * B1 (phase 7 mobile): token-lifecycle coverage for the native sign-in surface.
 * The fake mirrors `agent.service.test.ts` (no DB), so the test asserts the
 * revocation/rotation invariants the app depends on:
 *   - sign-in mints a device + hashed session with a `mobile:*` scope;
 *   - a burnt refresh token cannot be replayed;
 *   - revoking a device invalidates its access + refresh tokens.
 */

function fakeJwt() {
  const store = new Map<string, unknown>();
  return {
    signAsync: vi.fn(async (payload: object) => {
      const token = `jwt.${JSON.stringify(payload)}.${Math.random().toString(36).slice(2, 10)}`;
      store.set(token, payload);
      return token;
    }),
    verifyAsync: vi.fn(async (token: string) => {
      if (!store.has(token)) throw new Error('invalid');
      return store.get(token) as object;
    }),
  };
}

type Device = {
  id: string;
  userId: string;
  name: string;
  platform: string | null;
  publicKey: Uint8Array;
  pairedAt: Date;
  revokedAt: Date | null;
  lastSeenAt: Date | null;
  agentVersion: string | null;
};
type Session = {
  id: string;
  deviceId: string;
  jwtHash: string;
  refreshHash: string;
  issuedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
};

function fakePrisma(seed?: { devices?: Device[]; sessions?: Session[] }) {
  const devices: Device[] = seed?.devices ?? [];
  const sessions: Session[] = seed?.sessions ?? [];
  let nextId = 100;
  const gen = () => `id-${++nextId}`;
  const p = {
    calls: { devices, sessions },
    agentDevice: {
      create: async ({
        data,
      }: {
        data: { userId: string; name: string; platform: string | null; publicKey: Uint8Array };
      }) => {
        const row: Device = {
          id: gen(),
          pairedAt: new Date(),
          revokedAt: null,
          lastSeenAt: null,
          agentVersion: null,
          ...data,
        };
        devices.push(row);
        return { id: row.id, userId: row.userId };
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        devices.find((d) => d.id === where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<Device> }) => {
        const d = devices.find((r) => r.id === where.id);
        if (!d) return null;
        Object.assign(d, data);
        return d;
      },
    },
    agentSession: {
      create: async ({ data }: { data: Omit<Session, 'issuedAt' | 'revokedAt'> }) => {
        sessions.push({ ...data, issuedAt: new Date(), revokedAt: null });
        return data;
      },
      findUnique: async ({
        where,
      }: {
        where: { jwtHash?: string; refreshHash?: string };
      }) => {
        const row =
          (where.jwtHash && sessions.find((s) => s.jwtHash === where.jwtHash)) ||
          (where.refreshHash && sessions.find((s) => s.refreshHash === where.refreshHash)) ||
          null;
        if (!row) return null;
        const device = devices.find((d) => d.id === row.deviceId);
        return {
          ...row,
          device: device ? { userId: device.userId, revokedAt: device.revokedAt } : null,
        };
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const i = sessions.findIndex((s) => s.id === where.id);
        if (i >= 0) sessions.splice(i, 1);
        return {};
      },
      deleteMany: async ({ where }: { where: { deviceId: string } }) => {
        const before = sessions.length;
        for (let i = sessions.length - 1; i >= 0; i--) {
          if (sessions[i].deviceId === where.deviceId) sessions.splice(i, 1);
        }
        return { count: before - sessions.length };
      },
    },
    $transaction: async (arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: unknown) => Promise<unknown>)(p);
      }
      const out: unknown[] = [];
      for (const op of arg as Promise<unknown>[]) out.push(await op);
      return out;
    },
  };
  return p;
}

function authReturning(user: { id: string; email: string } | Error) {
  return {
    verifyCredentialsWithLockout: vi.fn(async () => {
      if (user instanceof Error) throw user;
      return user;
    }),
  };
}

const USER = { id: 'user-1', email: 'owner@example.com' };

describe('MobileService.signIn', () => {
  let prisma: ReturnType<typeof fakePrisma>;
  let jwt: ReturnType<typeof fakeJwt>;
  beforeEach(() => {
    prisma = fakePrisma();
    jwt = fakeJwt();
  });

  it('registers a device + session and returns a mobile-scoped token pair', async () => {
    const svc = new MobileService(prisma as never, jwt as never, authReturning(USER) as never);
    const out = await svc.signIn({
      email: USER.email,
      password: 'hunter2hunter2',
      ip: '1.2.3.4',
      deviceName: 'iPhone 16',
      platform: 'ios',
    });
    expect(out.deviceId).toBeTruthy();
    expect(out.userId).toBe('user-1');
    expect(out.email).toBe(USER.email);
    expect(out.refreshToken).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(prisma.calls.devices).toHaveLength(1);
    expect(prisma.calls.devices[0].platform).toBe('ios');
    expect(prisma.calls.sessions).toHaveLength(1);
    const verified = await svc.verifyBearer(out.jwt);
    expect(verified.deviceId).toBe(out.deviceId);
    expect(verified.userId).toBe('user-1');
  });

  it('propagates the credential failure and mints nothing', async () => {
    const svc = new MobileService(
      prisma as never,
      jwt as never,
      authReturning(new UnauthorizedException('Invalid email or password')) as never,
    );
    await expect(
      svc.signIn({ email: 'x', password: 'y', ip: '1.2.3.4', deviceName: 'Pixel' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.calls.devices).toHaveLength(0);
    expect(prisma.calls.sessions).toHaveLength(0);
    // MUTATION-SMOKE: drop the auth call and a device row appears despite bad creds.
  });
});

describe('MobileService.verifyBearer', () => {
  it('rejects a token minted with a different scope before touching the DB', async () => {
    const prisma = fakePrisma();
    const jwt = fakeJwt();
    const svc = new MobileService(prisma as never, jwt as never, authReturning(USER) as never);
    const foreign = await jwt.signAsync({
      sub: 'd',
      userId: 'u',
      scope: 'agent:*',
      sid: 's',
    });
    await expect(svc.verifyBearer(foreign)).rejects.toBeInstanceOf(UnauthorizedException);
    // MUTATION-SMOKE: drop the scope guard and this resolves via a session miss.
  });

  it('returns the payload on a live token', async () => {
    const prisma = fakePrisma();
    const jwt = fakeJwt();
    const svc = new MobileService(prisma as never, jwt as never, authReturning(USER) as never);
    const signed = await svc.signIn({
      email: USER.email,
      password: 'p',
      ip: '1.2.3.4',
      deviceName: 'Pixel',
    });
    const payload = await svc.verifyBearer(signed.jwt);
    expect(payload.sessionId).toBe(prisma.calls.sessions[0].id);
    expect(MOBILE_JWT_SCOPE).toBe('mobile:*');
  });
});

describe('MobileService.refresh', () => {
  it('rotates the pair and burns the old refresh token', async () => {
    const prisma = fakePrisma();
    const jwt = fakeJwt();
    const svc = new MobileService(prisma as never, jwt as never, authReturning(USER) as never);
    const signed = await svc.signIn({
      email: USER.email,
      password: 'p',
      ip: '1.2.3.4',
      deviceName: 'Pixel',
    });
    const rotated = await svc.refresh(signed.deviceId, signed.refreshToken);
    expect(rotated.jwt).not.toBe(signed.jwt);
    expect(rotated.refreshToken).not.toBe(signed.refreshToken);
    expect(prisma.calls.sessions).toHaveLength(1);
    await expect(svc.refresh(signed.deviceId, signed.refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a refresh aimed at a different deviceId', async () => {
    const prisma = fakePrisma();
    const jwt = fakeJwt();
    const svc = new MobileService(prisma as never, jwt as never, authReturning(USER) as never);
    const signed = await svc.signIn({
      email: USER.email,
      password: 'p',
      ip: '1.2.3.4',
      deviceName: 'Pixel',
    });
    await expect(svc.refresh('some-other-device', signed.refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

describe('MobileService.revoke', () => {
  it('drops every session and marks the device revoked', async () => {
    const prisma = fakePrisma();
    const jwt = fakeJwt();
    const svc = new MobileService(prisma as never, jwt as never, authReturning(USER) as never);
    const signed = await svc.signIn({
      email: USER.email,
      password: 'p',
      ip: '1.2.3.4',
      deviceName: 'Pixel',
    });
    await svc.revoke(signed.deviceId, 'user-1');
    expect(prisma.calls.sessions).toHaveLength(0);
    expect(prisma.calls.devices[0].revokedAt).toBeInstanceOf(Date);
    await expect(svc.verifyBearer(signed.jwt)).rejects.toBeInstanceOf(UnauthorizedException);
    // MUTATION-SMOKE: remove the session deleteMany and the token stays valid.
  });

  it('refuses a cross-user revoke', async () => {
    const prisma = fakePrisma();
    const jwt = fakeJwt();
    const svc = new MobileService(prisma as never, jwt as never, authReturning(USER) as never);
    const signed = await svc.signIn({
      email: USER.email,
      password: 'p',
      ip: '1.2.3.4',
      deviceName: 'Pixel',
    });
    await expect(svc.revoke(signed.deviceId, 'attacker')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.calls.devices[0].revokedAt).toBeNull();
  });
});
