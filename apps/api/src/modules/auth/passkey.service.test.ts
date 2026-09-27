import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';

// Mock @simplewebauthn/server so we exercise the service's own persistence +
// challenge-park invariants without stubbing a real authenticator.
vi.mock('@simplewebauthn/server', () => {
  return {
    generateRegistrationOptions: vi.fn(async () => ({
      challenge: 'reg-challenge-abc',
      rp: { name: 'Career OS', id: 'localhost' },
      user: { id: 'user-1', name: 'a@b.com', displayName: 'a@b.com' },
      pubKeyCredParams: [],
    })),
    generateAuthenticationOptions: vi.fn(async () => ({
      challenge: 'auth-challenge-xyz',
      rpId: 'localhost',
      allowCredentials: [],
    })),
    verifyRegistrationResponse: vi.fn(async (opts: { expectedChallenge: string }) => ({
      verified: opts.expectedChallenge === 'reg-challenge-abc',
      registrationInfo:
        opts.expectedChallenge === 'reg-challenge-abc'
          ? {
              fmt: 'none',
              aaguid: '00000000-0000-0000-0000-000000000000',
              credential: {
                id: 'Y3JlZGVudGlhbC1pZC1yYXc', // "credential-id-raw" base64url
                publicKey: new Uint8Array([1, 2, 3]),
                counter: 0,
                transports: ['internal'],
              },
              credentialType: 'public-key',
              userVerified: true,
              credentialDeviceType: 'singleDevice',
              credentialBackedUp: false,
              origin: 'http://localhost:3000',
              rpID: 'localhost',
              attestationObject: new Uint8Array(),
            }
          : undefined,
    })),
    verifyAuthenticationResponse: vi.fn(async (opts: { expectedChallenge: string }) => ({
      verified: opts.expectedChallenge === 'auth-challenge-xyz',
      authenticationInfo: {
        credentialID: 'Y3JlZGVudGlhbC1pZC1yYXc',
        newCounter: 42,
        userVerified: true,
        credentialDeviceType: 'singleDevice' as const,
        credentialBackedUp: false,
        origin: 'http://localhost:3000',
        rpID: 'localhost',
      },
    })),
  };
});

import { PasskeyService } from './passkey.service';

// Helper: build a clientDataJSON blob shaped like the browser would, base64url
// encoded so the service's `consumeChallenge` path is exercised as-in-prod.
function encodeClientData(challenge: string): string {
  const json = JSON.stringify({ type: 'webauthn.create', challenge, origin: 'http://localhost:3000' });
  return Buffer.from(json, 'utf8').toString('base64url');
}

// -- Fake Prisma --
type Cred = {
  id: string;
  userId: string;
  credentialId: Buffer;
  publicKey: Buffer;
  counter: bigint;
  transports: string[];
  name: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
};
type Challenge = { challenge: string; userId: string | null; kind: string; expiresAt: Date };

function fakePrisma(opts?: { creds?: Cred[]; user?: { email: string; displayName: string | null } | null }) {
  const creds: Cred[] = opts?.creds ?? [];
  const challenges: Challenge[] = [];
  return {
    calls: { creds, challenges },
    user: {
      findUnique: async () => opts?.user ?? { email: 'a@b.com', displayName: 'A' },
    },
    passkeyCredential: {
      findMany: async ({ where }: { where: { userId: string } }) =>
        creds.filter((c) => c.userId === where.userId),
      findUnique: async ({ where }: { where: { credentialId?: Buffer; id?: string } }) => {
        if (where.credentialId) {
          return creds.find((c) => c.credentialId.equals(where.credentialId!)) ?? null;
        }
        return creds.find((c) => c.id === where.id) ?? null;
      },
      create: async ({ data }: { data: Omit<Cred, 'id' | 'createdAt' | 'lastUsedAt'> }) => {
        const row: Cred = {
          id: `cred-${creds.length + 1}`,
          createdAt: new Date(),
          lastUsedAt: null,
          ...data,
        };
        creds.push(row);
        return { id: row.id, name: row.name };
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Cred> }) => {
        const c = creds.find((r) => r.id === where.id);
        if (!c) return null;
        Object.assign(c, data);
        return c;
      },
      deleteMany: async ({ where }: { where: { id: string; userId: string } }) => {
        const before = creds.length;
        const idx = creds.findIndex((c) => c.id === where.id && c.userId === where.userId);
        if (idx >= 0) creds.splice(idx, 1);
        return { count: before - creds.length };
      },
    },
    passkeyChallenge: {
      create: async ({ data }: { data: Challenge }) => {
        challenges.push({ ...data });
        return data;
      },
      findUnique: async ({ where }: { where: { challenge: string } }) =>
        challenges.find((c) => c.challenge === where.challenge) ?? null,
      delete: async ({ where }: { where: { challenge: string } }) => {
        const i = challenges.findIndex((c) => c.challenge === where.challenge);
        if (i >= 0) challenges.splice(i, 1);
        return {};
      },
    },
  };
}

function fakeSession() {
  const writes: string[] = [];
  return {
    writes,
    write: vi.fn(async (_res: unknown, userId: string) => {
      writes.push(userId);
      return 'session-id';
    }),
  };
}

// --- tests ---

describe('PasskeyService.generateRegistrationOptions', () => {
  beforeEach(() => {
    process.env.WEBAUTHN_ORIGIN = 'http://localhost:3000';
    process.env.WEBAUTHN_RP_ID = 'localhost';
  });

  it('returns options + parks the challenge for the caller', async () => {
    const prisma = fakePrisma();
    const svc = new PasskeyService(prisma as never, fakeSession() as never);
    const options = await svc.generateRegistrationOptions('user-1');
    expect(options.challenge).toBe('reg-challenge-abc');
    expect(prisma.calls.challenges).toHaveLength(1);
    expect(prisma.calls.challenges[0]).toMatchObject({
      challenge: 'reg-challenge-abc',
      userId: 'user-1',
      kind: 'register',
    });
    // MUTATION-SMOKE: remove the parkChallenge call and this assertion fails.
  });
});

describe('PasskeyService.verifyRegistration', () => {
  beforeEach(() => {
    process.env.WEBAUTHN_ORIGIN = 'http://localhost:3000';
    process.env.WEBAUTHN_RP_ID = 'localhost';
  });

  it('persists a credential when verification succeeds', async () => {
    const prisma = fakePrisma();
    const svc = new PasskeyService(prisma as never, fakeSession() as never);
    // Seed the parked challenge as if generateRegistrationOptions had run.
    prisma.calls.challenges.push({
      challenge: 'reg-challenge-abc',
      userId: 'user-1',
      kind: 'register',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const response = {
      id: 'ignored',
      rawId: 'ignored',
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: encodeClientData('reg-challenge-abc'),
        attestationObject: 'x',
      },
    };
    const out = await svc.verifyRegistration('user-1', response as never, 'MacBook');
    expect(out.credentialId).toBe('cred-1');
    expect(out.name).toBe('MacBook');
    expect(prisma.calls.creds).toHaveLength(1);
    expect(prisma.calls.creds[0].name).toBe('MacBook');
    // Challenge consumed.
    expect(prisma.calls.challenges).toHaveLength(0);
  });

  it('throws when the challenge is not parked', async () => {
    const prisma = fakePrisma();
    const svc = new PasskeyService(prisma as never, fakeSession() as never);
    const response = {
      id: 'x',
      rawId: 'x',
      type: 'public-key',
      clientExtensionResults: {},
      response: { clientDataJSON: encodeClientData('never-parked'), attestationObject: 'x' },
    };
    await expect(svc.verifyRegistration('user-1', response as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('throws when verifyRegistrationResponse says not verified', async () => {
    const prisma = fakePrisma();
    const svc = new PasskeyService(prisma as never, fakeSession() as never);
    prisma.calls.challenges.push({
      challenge: 'wrong-response',
      userId: 'user-1',
      kind: 'register',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const response = {
      id: 'x',
      rawId: 'x',
      type: 'public-key',
      clientExtensionResults: {},
      response: { clientDataJSON: encodeClientData('wrong-response'), attestationObject: 'x' },
    };
    await expect(svc.verifyRegistration('user-1', response as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    // MUTATION-SMOKE: drop the `if (!verification.verified) throw ...` guard
    // and this test fails.
  });

  it('refuses an expired challenge', async () => {
    const prisma = fakePrisma();
    const svc = new PasskeyService(prisma as never, fakeSession() as never);
    prisma.calls.challenges.push({
      challenge: 'reg-challenge-abc',
      userId: 'user-1',
      kind: 'register',
      expiresAt: new Date(Date.now() - 1_000),
    });
    const response = {
      id: 'x',
      rawId: 'x',
      type: 'public-key',
      clientExtensionResults: {},
      response: { clientDataJSON: encodeClientData('reg-challenge-abc'), attestationObject: 'x' },
    };
    await expect(svc.verifyRegistration('user-1', response as never)).rejects.toThrow(/expired/i);
  });

  it('refuses a challenge whose owner does not match the caller', async () => {
    const prisma = fakePrisma();
    const svc = new PasskeyService(prisma as never, fakeSession() as never);
    prisma.calls.challenges.push({
      challenge: 'reg-challenge-abc',
      userId: 'user-2',
      kind: 'register',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const response = {
      id: 'x',
      rawId: 'x',
      type: 'public-key',
      clientExtensionResults: {},
      response: { clientDataJSON: encodeClientData('reg-challenge-abc'), attestationObject: 'x' },
    };
    await expect(svc.verifyRegistration('user-1', response as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('PasskeyService.verifyAuthentication (login)', () => {
  beforeEach(() => {
    process.env.WEBAUTHN_ORIGIN = 'http://localhost:3000';
    process.env.WEBAUTHN_RP_ID = 'localhost';
  });

  it('returns userId + writes a session on match', async () => {
    const credId = Buffer.from('credential-id-raw', 'utf8');
    // The mock returns credentialID base64url("credential-id-raw"). To match
    // we store the same raw bytes.
    const b64urlCredId = Buffer.from(credId).toString('base64url');
    // Sanity: the mock's `credentialID: 'Y3JlZGVudGlhbC1pZC1yYXc'` decodes to
    // "credential-id-raw" so the lookup below matches.
    expect(b64urlCredId).toBe('Y3JlZGVudGlhbC1pZC1yYXc');
    const prisma = fakePrisma({
      creds: [
        {
          id: 'cred-x',
          userId: 'user-42',
          credentialId: credId,
          publicKey: Buffer.from([1, 2, 3]),
          counter: 0n,
          transports: ['internal'],
          name: 'Phone',
          createdAt: new Date(),
          lastUsedAt: null,
        },
      ],
    });
    const session = fakeSession();
    const svc = new PasskeyService(prisma as never, session as never);
    prisma.calls.challenges.push({
      challenge: 'auth-challenge-xyz',
      userId: null,
      kind: 'authenticate',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const response = {
      id: b64urlCredId,
      rawId: b64urlCredId,
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: encodeClientData('auth-challenge-xyz'),
        authenticatorData: 'x',
        signature: 'x',
        userHandle: 'x',
      },
    };
    const out = await svc.verifyAuthentication(response as never, {} as never);
    expect(out.userId).toBe('user-42');
    expect(session.writes).toEqual(['user-42']);
    // Counter advanced to mock's newCounter = 42.
    expect(prisma.calls.creds[0].counter).toBe(42n);
    expect(prisma.calls.creds[0].lastUsedAt).toBeInstanceOf(Date);
    // MUTATION-SMOKE: remove the session.write call and `session.writes` is empty.
  });

  it('rejects a login whose credentialId is not registered', async () => {
    const prisma = fakePrisma();
    prisma.calls.challenges.push({
      challenge: 'auth-challenge-xyz',
      userId: null,
      kind: 'authenticate',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const svc = new PasskeyService(prisma as never, fakeSession() as never);
    const response = {
      id: 'Y3JlZGVudGlhbC1pZC1yYXc',
      rawId: 'x',
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: encodeClientData('auth-challenge-xyz'),
        authenticatorData: 'x',
        signature: 'x',
        userHandle: 'x',
      },
    };
    await expect(svc.verifyAuthentication(response as never, {} as never)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a counter regression on subsequent login', async () => {
    // Seed credential with counter already ahead of what the mock will return.
    const credId = Buffer.from('credential-id-raw', 'utf8');
    const prisma = fakePrisma({
      creds: [
        {
          id: 'cred-x',
          userId: 'user-42',
          credentialId: credId,
          publicKey: Buffer.from([1]),
          counter: 100n,
          transports: [],
          name: null,
          createdAt: new Date(),
          lastUsedAt: null,
        },
      ],
    });
    prisma.calls.challenges.push({
      challenge: 'auth-challenge-xyz',
      userId: null,
      kind: 'authenticate',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const svc = new PasskeyService(prisma as never, fakeSession() as never);
    const response = {
      id: 'Y3JlZGVudGlhbC1pZC1yYXc',
      rawId: 'x',
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: encodeClientData('auth-challenge-xyz'),
        authenticatorData: 'x',
        signature: 'x',
        userHandle: 'x',
      },
    };
    await expect(svc.verifyAuthentication(response as never, {} as never)).rejects.toThrow(/regression/i);
  });
});

describe('PasskeyService.listCredentials / revokeCredential', () => {
  beforeEach(() => {
    process.env.WEBAUTHN_ORIGIN = 'http://localhost:3000';
    process.env.WEBAUTHN_RP_ID = 'localhost';
  });

  it('lists only the caller credentials + revokes by id', async () => {
    const prisma = fakePrisma({
      creds: [
        {
          id: 'cred-1',
          userId: 'user-1',
          credentialId: Buffer.from([1]),
          publicKey: Buffer.from([1]),
          counter: 0n,
          transports: [],
          name: 'A',
          createdAt: new Date(),
          lastUsedAt: null,
        },
        {
          id: 'cred-2',
          userId: 'user-2',
          credentialId: Buffer.from([2]),
          publicKey: Buffer.from([2]),
          counter: 0n,
          transports: [],
          name: 'B',
          createdAt: new Date(),
          lastUsedAt: null,
        },
      ],
    });
    const svc = new PasskeyService(prisma as never, fakeSession() as never);
    const list = await svc.listCredentials('user-1');
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('cred-1');
    await svc.revokeCredential('user-1', 'cred-1');
    expect(prisma.calls.creds.find((c) => c.id === 'cred-1')).toBeUndefined();
    // Cross-user revoke is a no-op → NotFound.
    await expect(svc.revokeCredential('user-1', 'cred-2')).rejects.toThrow(/not found/i);
  });
});
