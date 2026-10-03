import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AgentController } from './agent.controller';
import { AgentJwtGuard } from './agent.jwt-strategy';

// The controller tests exercise the auth + audit + rate-limit-decorator
// contract. Real HTTP integration lives above (auth.service.test.ts pattern
// keeps this file mock-only).

function fakeSession(seed: { userId?: string; createdAt?: number } | null = {}) {
  return {
    read: vi.fn(() =>
      seed
        ? { userId: seed.userId ?? 'user-1', createdAt: seed.createdAt ?? Date.now(), sessionId: 'sid', expiresAt: Date.now() + 60_000 }
        : null,
    ),
    requireUserId: vi.fn(() => {
      if (!seed) throw new UnauthorizedException('Not signed in');
      return seed.userId ?? 'user-1';
    }),
  };
}

function fakePrisma() {
  const audits: Array<{ action: string; payload: unknown }> = [];
  return {
    audits,
    auditEvent: {
      create: async ({ data }: { data: { action: string; payload: unknown } }) => {
        audits.push({ action: data.action, payload: data.payload });
        return {};
      },
    },
  };
}

function fakeAgents() {
  return {
    pairStart: vi.fn(async (userId: string) => ({
      code: '123456',
      pairingRequestId: `preq-${userId}`,
      expiresAt: new Date(Date.now() + 600_000),
    })),
    pairComplete: vi.fn(
      async (_code: string, name: string, _publicKey?: Buffer, _agentVersion?: string, _platform?: string) => ({
        deviceId: `dev-${name}`,
        jwt: 'jwt.x',
        refreshToken: 'refresh.x',
        expiresAt: new Date(Date.now() + 3_600_000),
      }),
    ),
    pairRefresh: vi.fn(async (deviceId: string) => ({
      deviceId,
      jwt: 'jwt.rotated',
      refreshToken: 'refresh.rotated',
      expiresAt: new Date(Date.now() + 3_600_000),
    })),
    revokeDevice: vi.fn(async (_id: string, _userId: string | null) => undefined),
    listDevices: vi.fn(async () => [{ id: 'd1', name: 'A' }]),
    verifyBearer: vi.fn(async (t: string) => {
      if (t === 'good') return { deviceId: 'dev-1', userId: 'user-1', sessionId: 'sid-1' };
      throw new UnauthorizedException('bad');
    }),
    recordTaskResult: vi.fn(async () => undefined),
    touchDevice: vi.fn(async () => undefined),
  };
}

function req(over?: Partial<{ headers: Record<string, string>; ip: string; agent: unknown }>) {
  return {
    headers: over?.headers ?? {},
    ip: over?.ip ?? '1.1.1.1',
    socket: { remoteAddress: '1.1.1.1' },
    agent: over?.agent,
  } as never;
}

// ------ pair/start ------

describe('AgentController.pairStart', () => {
  it('requires a session cookie', async () => {
    const c = new AgentController(fakeAgents() as never, fakeSession(null) as never, fakePrisma() as never);
    await expect(c.pairStart(req())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires fresh <5 min re-auth', async () => {
    const stale = fakeSession({ createdAt: Date.now() - 10 * 60 * 1000 });
    const c = new AgentController(fakeAgents() as never, stale as never, fakePrisma() as never);
    await expect(c.pairStart(req())).rejects.toThrow(/Fresh re-authentication/);
  });

  it('mints a code + writes agent.pair.started audit', async () => {
    const agents = fakeAgents();
    const prisma = fakePrisma();
    const c = new AgentController(agents as never, fakeSession() as never, prisma as never);
    const out = await c.pairStart(req());
    expect(out.code).toBe('123456');
    expect(prisma.audits.map((a) => a.action)).toContain('agent.pair.started');
  });
});

// ------ pair/complete ------

describe('AgentController.pairComplete', () => {
  it('writes agent.pair.completed on success', async () => {
    const agents = fakeAgents();
    const prisma = fakePrisma();
    const c = new AgentController(agents as never, fakeSession() as never, prisma as never);
    await c.pairComplete(req(), {
      code: '123456',
      deviceName: 'Mac',
      publicKey: Buffer.from([1, 2]).toString('base64'),
      agentVersion: 'v0.1',
      platform: 'darwin',
    });
    expect(prisma.audits.map((a) => a.action)).toContain('agent.pair.completed');
    // Platform is forwarded to the service so listDevices can show it.
    expect(agents.pairComplete).toHaveBeenCalledWith(
      '123456',
      'Mac',
      expect.any(Buffer),
      'v0.1',
      'darwin',
    );
  });

  it('writes agent.pair.failed with reason on missing fields', async () => {
    const prisma = fakePrisma();
    const c = new AgentController(fakeAgents() as never, fakeSession() as never, prisma as never);
    await expect(c.pairComplete(req(), {})).rejects.toBeInstanceOf(ForbiddenException);
    const fail = prisma.audits.find((a) => a.action === 'agent.pair.failed');
    expect(fail).toBeTruthy();
    expect((fail!.payload as { reason: string }).reason).toBe('missing_fields');
  });

  it('writes agent.pair.failed on wrong code (401 from service)', async () => {
    const agents = fakeAgents();
    agents.pairComplete = vi.fn(async () => {
      throw new UnauthorizedException('Invalid pairing code');
    });
    const prisma = fakePrisma();
    const c = new AgentController(agents as never, fakeSession() as never, prisma as never);
    await expect(
      c.pairComplete(req(), {
        code: '000000',
        deviceName: 'x',
        publicKey: Buffer.from([1]).toString('base64'),
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    const fail = prisma.audits.find((a) => a.action === 'agent.pair.failed');
    expect(fail).toBeTruthy();
  });
});

// ------ rate-limit decorator metadata ------

describe('AgentController rate-limits (decorator metadata)', () => {
  it('pair/complete is 5/hr per IP (spec)', () => {
    const reflector = new Reflector();
    const method = AgentController.prototype.pairComplete;
    // @nestjs/throttler v6 stores each throttler cfg under keys like
    // "THROTTLER:TTL<name>" + "THROTTLER:LIMIT<name>". The default throttler
    // uses name "default" so the key becomes "THROTTLER:TTLdefault".
    const ttl = reflector.get<number>('THROTTLER:TTLdefault', method);
    const limit = reflector.get<number>('THROTTLER:LIMITdefault', method);
    expect(ttl).toBe(60 * 60 * 1000);
    expect(limit).toBe(5);
    // MUTATION-SMOKE: change the ttl to 60_000 in the decorator and this fails.
  });

  it('pair/start is 3/min per IP', () => {
    const reflector = new Reflector();
    const method = AgentController.prototype.pairStart;
    const ttl = reflector.get<number>('THROTTLER:TTLdefault', method);
    const limit = reflector.get<number>('THROTTLER:LIMITdefault', method);
    expect(ttl).toBe(60_000);
    expect(limit).toBe(3);
  });
});

// ------ pair/revoke: session vs JWT ------

describe('AgentController.pairRevoke', () => {
  it('session path revokes by explicit deviceId', async () => {
    const agents = fakeAgents();
    const prisma = fakePrisma();
    const c = new AgentController(agents as never, fakeSession() as never, prisma as never);
    await c.pairRevoke(req(), { deviceId: 'd1' });
    expect(agents.revokeDevice).toHaveBeenCalledWith('d1', 'user-1');
    expect(prisma.audits.map((a) => a.action)).toContain('agent.device.revoked');
  });

  it('session path requires body.deviceId', async () => {
    const c = new AgentController(fakeAgents() as never, fakeSession() as never, fakePrisma() as never);
    await expect(c.pairRevoke(req(), {})).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('JWT path uses the token deviceId (agent self-revoke)', async () => {
    const agents = fakeAgents();
    const prisma = fakePrisma();
    // No session cookie: session.read → null so the controller routes to
    // the bearer branch.
    const c = new AgentController(agents as never, fakeSession(null) as never, prisma as never);
    await c.pairRevoke(
      req({ headers: { authorization: 'Bearer good' } }),
      {},
    );
    expect(agents.verifyBearer).toHaveBeenCalledWith('good');
    expect(agents.revokeDevice).toHaveBeenCalledWith('dev-1', null);
  });

  it('no auth at all rejects', async () => {
    const c = new AgentController(fakeAgents() as never, fakeSession(null) as never, fakePrisma() as never);
    await expect(c.pairRevoke(req(), {})).rejects.toBeInstanceOf(ForbiddenException);
  });
});

// ------ tasks/:id/result (JWT-authed) ------

describe('AgentController.postTaskResult', () => {
  it('records the result + writes agent.task.result.received audit', async () => {
    const agents = fakeAgents();
    const prisma = fakePrisma();
    const c = new AgentController(agents as never, fakeSession() as never, prisma as never);
    await c.postTaskResult(
      req({ agent: { deviceId: 'dev-1', userId: 'user-1', sessionId: 'sid' } }),
      't1',
      { status: 'completed', resultJson: { ok: true } },
    );
    expect(agents.recordTaskResult).toHaveBeenCalledWith('t1', 'dev-1', 'completed', { ok: true });
    expect(prisma.audits.map((a) => a.action)).toContain('agent.task.result.received');
  });

  it('rejects an unknown status', async () => {
    const c = new AgentController(fakeAgents() as never, fakeSession() as never, fakePrisma() as never);
    await expect(
      c.postTaskResult(
        req({ agent: { deviceId: 'dev-1', userId: 'user-1', sessionId: 'sid' } }),
        't1',
        { status: 'weird' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

// ------ JWT scope: session cookie cannot mint agent auth ------

describe('AgentJwtGuard', () => {
  it('rejects a request with no bearer token', async () => {
    const agents = fakeAgents();
    const guard = new AgentJwtGuard(agents as never);
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
    };
    await expect(guard.canActivate(ctx as never)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a session-cookie-only request (no bearer)', async () => {
    const agents = fakeAgents();
    const guard = new AgentJwtGuard(agents as never);
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: { cookie: 'careeros_session=sealed' } }),
      }),
    };
    await expect(guard.canActivate(ctx as never)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(agents.verifyBearer).not.toHaveBeenCalled();
    // MUTATION-SMOKE: if the guard fell back to req.session, this call would
    // land, so verifyBearer would be invoked — the assertion catches it.
  });

  it('accepts a bearer that verifyBearer accepts', async () => {
    const agents = fakeAgents();
    const guard = new AgentJwtGuard(agents as never);
    const seen: { agent?: unknown } = {};
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => Object.assign(seen, { headers: { authorization: 'Bearer good' } }),
      }),
    };
    await expect(guard.canActivate(ctx as never)).resolves.toBe(true);
    expect(seen.agent).toEqual({ deviceId: 'dev-1', userId: 'user-1', sessionId: 'sid-1' });
  });
});
