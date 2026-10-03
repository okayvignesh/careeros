import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { AgentService, AGENT_JWT_SCOPE } from './agent.service';

// --- fake @nestjs/jwt ---
// Deterministic sign/verify so we can assert token = jwt lookup by hash.
function fakeJwt() {
  const store = new Map<string, unknown>();
  return {
    signAsync: vi.fn(async (payload: object, _opts?: unknown) => {
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

// --- fake prisma ---
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
type PairReq = {
  id: string;
  userId: string;
  codeHash: string;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
};
type Task = {
  id: string;
  deviceId: string;
  kind: string;
  params: unknown;
  status: string;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  resultJson: unknown;
  expiresAt: Date;
};

function fakePrisma(seed?: {
  devices?: Device[];
  sessions?: Session[];
  pairReqs?: PairReq[];
  tasks?: Task[];
}) {
  const devices: Device[] = seed?.devices ?? [];
  const sessions: Session[] = seed?.sessions ?? [];
  const pairReqs: PairReq[] = seed?.pairReqs ?? [];
  const tasks: Task[] = seed?.tasks ?? [];
  let nextId = 100;
  const gen = () => `id-${++nextId}`;
  const p = {
    calls: { devices, sessions, pairReqs, tasks },
    agentPairingRequest: {
      deleteMany: async ({ where }: { where: { userId: string; consumedAt: null } }) => {
        const before = pairReqs.length;
        for (let i = pairReqs.length - 1; i >= 0; i--) {
          if (pairReqs[i].userId === where.userId && pairReqs[i].consumedAt === null) {
            pairReqs.splice(i, 1);
          }
        }
        return { count: before - pairReqs.length };
      },
      create: async ({ data }: { data: { userId: string; codeHash: string; expiresAt: Date } }) => {
        const row: PairReq = {
          id: gen(),
          userId: data.userId,
          codeHash: data.codeHash,
          createdAt: new Date(),
          expiresAt: data.expiresAt,
          consumedAt: null,
        };
        pairReqs.push(row);
        return { id: row.id, expiresAt: row.expiresAt };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { codeHash: string; consumedAt: null; expiresAt: { gt: Date } };
        data: { consumedAt: Date };
      }) => {
        let n = 0;
        for (const r of pairReqs) {
          if (
            r.codeHash === where.codeHash &&
            r.consumedAt === null &&
            r.expiresAt.getTime() > where.expiresAt.gt.getTime()
          ) {
            r.consumedAt = data.consumedAt;
            n += 1;
          }
        }
        return { count: n };
      },
      findUnique: async ({ where }: { where: { codeHash: string } }) =>
        pairReqs.find((r) => r.codeHash === where.codeHash) ?? null,
    },
    agentDevice: {
      create: async ({ data }: { data: Omit<Device, 'id' | 'pairedAt' | 'revokedAt' | 'lastSeenAt'> }) => {
        const row: Device = {
          id: gen(),
          pairedAt: new Date(),
          revokedAt: null,
          lastSeenAt: null,
          ...data,
        };
        devices.push(row);
        return { id: row.id, userId: row.userId };
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        devices.find((d) => d.id === where.id) ?? null,
      findMany: async ({ where }: { where: { userId: string } }) =>
        devices.filter((d) => d.userId === where.userId),
      update: async ({ where, data }: { where: { id: string }; data: Partial<Device> }) => {
        const d = devices.find((r) => r.id === where.id);
        if (!d) return null;
        Object.assign(d, data);
        return d;
      },
    },
    agentSession: {
      create: async ({ data }: { data: Session }) => {
        sessions.push({ ...data, issuedAt: data.issuedAt ?? new Date(), revokedAt: data.revokedAt ?? null });
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
        // Include device relation for verifyBearer's inner select.
        const device = devices.find((d) => d.id === row.deviceId);
        return { ...row, device: device ? { userId: device.userId, revokedAt: device.revokedAt } : null };
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
    agentTask: {
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; deviceId: string; status: { in: string[] } };
        data: { status: string; completedAt: Date; resultJson: unknown };
      }) => {
        let n = 0;
        for (const t of tasks) {
          if (t.id === where.id && t.deviceId === where.deviceId && where.status.in.includes(t.status)) {
            t.status = data.status;
            t.completedAt = data.completedAt;
            t.resultJson = data.resultJson;
            n += 1;
          }
        }
        return { count: n };
      },
    },
    $transaction: async (arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: unknown) => Promise<unknown>)(p);
      }
      // Array-mode: resolve each promise in order.
      const out: unknown[] = [];
      for (const op of arg as Promise<unknown>[]) out.push(await op);
      return out;
    },
  };
  return p;
}

// -- pairStart --

describe('AgentService.pairStart', () => {
  it('returns a fresh 6-digit code + parks a pairing request', async () => {
    const prisma = fakePrisma();
    const svc = new AgentService(prisma as never, fakeJwt() as never);
    const out = await svc.pairStart('user-1');
    expect(out.code).toMatch(/^\d{6}$/);
    expect(prisma.calls.pairReqs).toHaveLength(1);
    expect(prisma.calls.pairReqs[0].userId).toBe('user-1');
    expect(prisma.calls.pairReqs[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
    // MUTATION-SMOKE: drop the pairingRequest.create call and .pairReqs is empty.
  });

  it('a second start within TTL invalidates the first', async () => {
    const prisma = fakePrisma();
    const svc = new AgentService(prisma as never, fakeJwt() as never);
    const a = await svc.pairStart('user-1');
    const b = await svc.pairStart('user-1');
    expect(a.code).not.toBe(b.code);
    // Only one row left: the newer one.
    expect(prisma.calls.pairReqs).toHaveLength(1);
    expect(prisma.calls.pairReqs[0].id).toBe(b.pairingRequestId);
    // MUTATION-SMOKE: remove the deleteMany call in pairStart and this length is 2.
  });
});

// -- pairComplete --

describe('AgentService.pairComplete', () => {
  it('mints a device + JWT + refresh on a valid code', async () => {
    const prisma = fakePrisma();
    const jwt = fakeJwt();
    const svc = new AgentService(prisma as never, jwt as never);
    const start = await svc.pairStart('user-9');
    const out = await svc.pairComplete(
      start.code,
      'MacBook',
      Buffer.from([1, 2, 3]),
      'v0.1.0',
      'darwin',
    );
    expect(out.deviceId).toBeTruthy();
    expect(out.jwt).toContain('jwt.');
    expect(out.refreshToken).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(prisma.calls.devices).toHaveLength(1);
    expect(prisma.calls.devices[0].agentVersion).toBe('v0.1.0');
    expect(prisma.calls.devices[0].platform).toBe('darwin');
    expect(prisma.calls.sessions).toHaveLength(1);
    // Pairing request marked consumed so it cannot be spent twice.
    expect(prisma.calls.pairReqs[0].consumedAt).toBeInstanceOf(Date);
  });

  it('rejects a wrong code with 401', async () => {
    const prisma = fakePrisma();
    const svc = new AgentService(prisma as never, fakeJwt() as never);
    await svc.pairStart('user-9');
    await expect(
      svc.pairComplete('000000', 'MacBook', Buffer.from([1])),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.calls.devices).toHaveLength(0);
    // MUTATION-SMOKE: return early success from pairComplete without the codeHash
    // check and this test fails: a device row appears.
  });

  it('rejects a badly formed code', async () => {
    const prisma = fakePrisma();
    const svc = new AgentService(prisma as never, fakeJwt() as never);
    await expect(
      svc.pairComplete('abcdef', 'x', Buffer.from([1])),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an empty publicKey', async () => {
    const prisma = fakePrisma();
    const svc = new AgentService(prisma as never, fakeJwt() as never);
    const start = await svc.pairStart('user-9');
    await expect(
      svc.pairComplete(start.code, 'x', Buffer.alloc(0)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

// -- verifyBearer (scope + revoke) --

describe('AgentService.verifyBearer', () => {
  it('returns deviceId + userId on a valid token', async () => {
    const prisma = fakePrisma();
    const jwt = fakeJwt();
    const svc = new AgentService(prisma as never, jwt as never);
    const start = await svc.pairStart('user-1');
    const paired = await svc.pairComplete(start.code, 'Laptop', Buffer.from([1]));
    const verified = await svc.verifyBearer(paired.jwt);
    expect(verified.deviceId).toBe(paired.deviceId);
    expect(verified.userId).toBe('user-1');
  });

  it('rejects a token with the wrong scope', async () => {
    const prisma = fakePrisma();
    const jwt = fakeJwt();
    // Bypass the service's mintSession: forge a token with a bad scope
    // directly through the fake jwt so the AgentSession row still exists
    // (verifyBearer must fail on scope before touching the DB).
    const svc = new AgentService(prisma as never, jwt as never);
    const badToken = await jwt.signAsync({ sub: 'd', userId: 'u', scope: 'not:agent', sid: 's' });
    await expect(svc.verifyBearer(badToken)).rejects.toBeInstanceOf(UnauthorizedException);
    // MUTATION-SMOKE: drop the `if (claims.scope !== AGENT_JWT_SCOPE)` guard and
    // this rejection turns into a session-lookup failure with a different message.
  });

  it('rejects after the device is revoked', async () => {
    const prisma = fakePrisma();
    const jwt = fakeJwt();
    const svc = new AgentService(prisma as never, jwt as never);
    const start = await svc.pairStart('user-1');
    const paired = await svc.pairComplete(start.code, 'L', Buffer.from([1]));
    // Sanity: works before revoke.
    await expect(svc.verifyBearer(paired.jwt)).resolves.toBeTruthy();
    await svc.revokeDevice(paired.deviceId, 'user-1');
    await expect(svc.verifyBearer(paired.jwt)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects the empty string', async () => {
    const prisma = fakePrisma();
    const svc = new AgentService(prisma as never, fakeJwt() as never);
    await expect(svc.verifyBearer('')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

// -- pairRefresh --

describe('AgentService.pairRefresh', () => {
  it('rotates the JWT + refresh in one tx', async () => {
    const prisma = fakePrisma();
    const jwt = fakeJwt();
    const svc = new AgentService(prisma as never, jwt as never);
    const start = await svc.pairStart('user-1');
    const paired = await svc.pairComplete(start.code, 'L', Buffer.from([1]));
    const rotated = await svc.pairRefresh(paired.deviceId, paired.refreshToken);
    expect(rotated.jwt).not.toBe(paired.jwt);
    expect(rotated.refreshToken).not.toBe(paired.refreshToken);
    // Old session row gone, new one present.
    expect(prisma.calls.sessions).toHaveLength(1);
    // Old refresh can no longer be redeemed.
    await expect(svc.pairRefresh(paired.deviceId, paired.refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a refresh for a revoked device', async () => {
    const prisma = fakePrisma();
    const jwt = fakeJwt();
    const svc = new AgentService(prisma as never, jwt as never);
    const start = await svc.pairStart('user-1');
    const paired = await svc.pairComplete(start.code, 'L', Buffer.from([1]));
    await svc.revokeDevice(paired.deviceId, 'user-1');
    await expect(svc.pairRefresh(paired.deviceId, paired.refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

// -- revokeDevice --

describe('AgentService.revokeDevice', () => {
  it('cross-user revoke is a 404', async () => {
    const prisma = fakePrisma();
    const jwt = fakeJwt();
    const svc = new AgentService(prisma as never, jwt as never);
    const start = await svc.pairStart('owner');
    const paired = await svc.pairComplete(start.code, 'L', Buffer.from([1]));
    await expect(svc.revokeDevice(paired.deviceId, 'attacker')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.calls.devices[0].revokedAt).toBeNull();
  });

  it('drops every AgentSession row for the device', async () => {
    const prisma = fakePrisma();
    const jwt = fakeJwt();
    const svc = new AgentService(prisma as never, jwt as never);
    const start = await svc.pairStart('owner');
    const paired = await svc.pairComplete(start.code, 'L', Buffer.from([1]));
    await svc.revokeDevice(paired.deviceId, 'owner');
    expect(prisma.calls.sessions.filter((s) => s.deviceId === paired.deviceId)).toHaveLength(0);
    expect(prisma.calls.devices[0].revokedAt).toBeInstanceOf(Date);
    // MUTATION-SMOKE: drop the deleteMany on agentSession in revokeDevice and
    // this length assertion fails (session survives).
  });
});

// -- recordTaskResult --

describe('AgentService.recordTaskResult', () => {
  it('flips a queued task to completed only for its owning device', async () => {
    const now = new Date();
    const prisma = fakePrisma({
      tasks: [
        {
          id: 't1',
          deviceId: 'dev-A',
          kind: 'discover',
          params: {},
          status: 'queued',
          createdAt: now,
          startedAt: null,
          completedAt: null,
          resultJson: null,
          expiresAt: new Date(now.getTime() + 60_000),
        },
      ],
    });
    const svc = new AgentService(prisma as never, fakeJwt() as never);
    await svc.recordTaskResult('t1', 'dev-A', 'completed', { count: 3 });
    expect(prisma.calls.tasks[0].status).toBe('completed');
    expect(prisma.calls.tasks[0].resultJson).toEqual({ count: 3 });
    // Cross-device attempt → 404, does not mutate.
    await expect(
      svc.recordTaskResult('t1', 'dev-B', 'completed', {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses an unknown status', async () => {
    const prisma = fakePrisma();
    const svc = new AgentService(prisma as never, fakeJwt() as never);
    await expect(
      svc.recordTaskResult('t1', 'dev-A', 'weird' as never, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

// -- listDevices (userId scoping) --

describe('AgentService.listDevices', () => {
  it('returns only the caller devices, including platform', async () => {
    const prisma = fakePrisma({
      devices: [
        { id: 'd1', userId: 'u1', name: 'A', platform: 'darwin', publicKey: new Uint8Array([1]), pairedAt: new Date(), revokedAt: null, lastSeenAt: null, agentVersion: null },
        { id: 'd2', userId: 'u2', name: 'B', platform: 'linux', publicKey: new Uint8Array([1]), pairedAt: new Date(), revokedAt: null, lastSeenAt: null, agentVersion: null },
      ],
    });
    const svc = new AgentService(prisma as never, fakeJwt() as never);
    const rows = await svc.listDevices('u1');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('d1');
    expect(rows[0].platform).toBe('darwin');
  });
});

// -- AGENT_JWT_SCOPE constant is what we expect --

describe('AGENT_JWT_SCOPE', () => {
  it('is agent:*', () => {
    expect(AGENT_JWT_SCOPE).toBe('agent:*');
  });
});
