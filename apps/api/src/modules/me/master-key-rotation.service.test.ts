// Master-key rotation service. DB-free: the service only talks to
// `prisma.rawClient`, so a structurally-fake raw client exercises the walk,
// per-row transactions, idempotent resume and partial-failure stop.
import { describe, expect, it } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import {
  decrypt,
  decryptField,
  encrypt,
  encryptField,
  loadMasterKey,
} from '@careeros/secrets';
import { ENCRYPTED_FIELDS, prismaDelegateName } from '../../prisma/prisma.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { SensitivityGateService } from '../../common/sensitivity-gate.service';
import { MasterKeyRotationService, ROTATE_MASTER_KEY_OP } from './master-key-rotation.service';

interface StoredSecret {
  id: string;
  purpose: string;
  ciphertext: string;
}

interface Update {
  model: string;
  id: string;
  data: Record<string, unknown>;
}

const FIELD_DELEGATES = Object.keys(ENCRYPTED_FIELDS).map(prismaDelegateName);

/** Structural fake of `PrismaService.rawClient` (unextended Prisma client). */
function fakeRaw(seed: {
  secrets?: StoredSecret[];
  fields?: Record<string, Array<Record<string, unknown>>>;
}): { rawClient: PrismaService['rawClient']; updates: Update[] } {
  const updates: Update[] = [];
  // Mutable stores: an update must be visible to a later findMany, exactly like
  // the real DB — needed to prove idempotent resume.
  const secrets = [...(seed.secrets ?? [])];
  const fieldRows: Record<string, Array<Record<string, unknown>>> = {};
  for (const delegate of FIELD_DELEGATES) {
    fieldRows[delegate] = [...(seed.fields?.[delegate] ?? [])];
  }

  const updateFor =
    (model: string) =>
    async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      updates.push({ model, id: args.where.id, data: args.data });
      if (model === 'EncryptedSecret') {
        const row = secrets.find((s) => s.id === args.where.id);
        if (row) Object.assign(row, args.data);
        return;
      }
      const rows = fieldRows[model] ?? [];
      const row = rows.find((r) => r.id === args.where.id);
      if (row) Object.assign(row, args.data);
    };

  const tx: Record<string, unknown> = {
    encryptedSecret: { update: updateFor('EncryptedSecret') },
  };
  for (const delegate of FIELD_DELEGATES) tx[delegate] = { update: updateFor(delegate) };

  const raw: Record<string, unknown> = {
    encryptedSecret: { findMany: async () => secrets },
    $transaction: async <T>(fn: (client: unknown) => Promise<T>): Promise<T> => fn(tx),
  };
  for (const delegate of FIELD_DELEGATES) {
    raw[delegate] = {
      findMany: async () => fieldRows[delegate] ?? [],
    };
  }

  return { rawClient: raw as unknown as PrismaService['rawClient'], updates };
}

function makeService(rawClient: PrismaService['rawClient']): {
  svc: MasterKeyRotationService;
  gate: SensitivityGateService;
} {
  const gate = new SensitivityGateService({} as never, { warn() {} } as never);
  const svc = new MasterKeyRotationService({ rawClient } as unknown as PrismaService, gate);
  return { svc, gate };
}

const PURPOSE = 'provider:deepseek:apiKey';
const oldKey = Buffer.from('a'.repeat(64), 'hex');
const newKey = Buffer.from('b'.repeat(64), 'hex');
const thirdKey = Buffer.from('c'.repeat(64), 'hex');

describe('MasterKeyRotationService fresh re-auth', () => {
  it('rejects rotation when the user has not re-authed in-window', async () => {
    const { rawClient } = fakeRaw({});
    const { svc } = makeService(rawClient);
    await expect(
      svc.rotate({ userId: 'user-1', newKey: newKey.toString('hex') }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a weak / malformed new key even after fresh re-auth', async () => {
    const { rawClient } = fakeRaw({});
    const { svc, gate } = makeService(rawClient);
    gate.withReauthWindow('user-1', ROTATE_MASTER_KEY_OP);
    await expect(svc.rotate({ userId: 'user-1', newKey: 'changeme' })).rejects.toThrow(
      /known-weak/,
    );
    await expect(svc.rotate({ userId: 'user-1', newKey: 'deadbeef' })).rejects.toThrow(
      /too short/,
    );
    // 44 bytes so assertStrongKey passes, but not valid base64 → format check.
    await expect(
      svc.rotate({ userId: 'user-1', newKey: `${'!'.repeat(43)}=` }),
    ).rejects.toThrow(/64 hex chars or 44 base64/);
  });

  it('accepts after fresh re-auth and reads the running key from env', async () => {
    const envKey = loadMasterKey();
    const { rawClient, updates } = fakeRaw({
      secrets: [{ id: 's1', purpose: PURPOSE, ciphertext: encrypt('sk-live', envKey, PURPOSE) }],
    });
    const { svc, gate } = makeService(rawClient);
    gate.withReauthWindow('user-1', ROTATE_MASTER_KEY_OP);
    const progress = await svc.rotate({ userId: 'user-1', newKey: newKey.toString('hex') });
    expect(progress.rotated).toBe(1);
    expect(updates).toHaveLength(1);
    expect(decrypt(updates[0]!.data.ciphertext as string, newKey, PURPOSE)).toBe('sk-live');
  });
});

describe('MasterKeyRotationService.rotateWithKeys', () => {
  it('re-encrypts secrets and field columns to the new key, one update each', async () => {
    const { rawClient, updates } = fakeRaw({
      secrets: [
        { id: 's1', purpose: PURPOSE, ciphertext: encrypt('api-key', oldKey, PURPOSE) },
      ],
      fields: {
        resumeFact: [{ id: 'r1', content: encryptField('{"bullet":"x"}', oldKey, 'content') }],
        llmHallucinationLog: [{ id: 'h1', snippet: encryptField('raw excerpt', oldKey, 'snippet') }],
      },
    });
    const { svc } = makeService(rawClient);
    const progress = await svc.rotateWithKeys(oldKey, newKey);

    expect(progress.stopped).toBe(false);
    expect(progress.failure).toBeNull();
    expect(progress.rotated).toBe(3);
    expect(updates).toHaveLength(3);

    const secretUpdate = updates.find((u) => u.model === 'EncryptedSecret')!;
    expect(decrypt(secretUpdate.data.ciphertext as string, newKey, PURPOSE)).toBe('api-key');
    expect(() => decrypt(secretUpdate.data.ciphertext as string, oldKey, PURPOSE)).toThrow();

    const factUpdate = updates.find((u) => u.model === 'resumeFact')!;
    expect(decryptField(factUpdate.data.content as string, newKey, 'content')).toBe(
      '{"bullet":"x"}',
    );
  });

  it('is idempotent: a second run skips already-rotated rows and writes nothing', async () => {
    const { rawClient, updates } = fakeRaw({
      secrets: [{ id: 's1', purpose: PURPOSE, ciphertext: encrypt('api-key', oldKey, PURPOSE) }],
      fields: { evidence: [{ id: 'e1', detail: encryptField('detail', oldKey, 'detail') }] },
    });
    const { svc } = makeService(rawClient);
    const first = await svc.rotateWithKeys(oldKey, newKey);
    expect(first.rotated).toBe(2);
    const writesAfterFirst = updates.length;

    const second = await svc.rotateWithKeys(oldKey, newKey);
    expect(second.rotated).toBe(0);
    expect(second.alreadyRotated).toBe(2);
    expect(second.stopped).toBe(false);
    expect(updates).toHaveLength(writesAfterFirst); // no rewrite of already-new rows
  });

  it('stops at the first undecryptable row, reports it, and leaves later rows untouched', async () => {
    const { rawClient, updates } = fakeRaw({
      secrets: [
        { id: 'good', purpose: PURPOSE, ciphertext: encrypt('ok', oldKey, PURPOSE) },
        { id: 'bad', purpose: PURPOSE, ciphertext: encrypt('lost', thirdKey, PURPOSE) },
        { id: 'later', purpose: PURPOSE, ciphertext: encrypt('never', oldKey, PURPOSE) },
      ],
    });
    const { svc } = makeService(rawClient);
    const progress = await svc.rotateWithKeys(oldKey, newKey);

    expect(progress.stopped).toBe(true);
    expect(progress.failed).toBe(1);
    expect(progress.failure).toEqual({
      source: 'EncryptedSecret',
      id: 'bad',
      message: expect.stringContaining('refusing to rotate'),
    });
    // Only the successfully rotated rows before the failure were written.
    expect(updates.map((u) => u.id)).toEqual(['good']);
  });

  it('leaves legacy plaintext field values alone and counts them as skipped', async () => {
    const { rawClient, updates } = fakeRaw({
      fields: { application: [{ id: 'a1', notes: 'plain legacy note' }] },
    });
    const { svc } = makeService(rawClient);
    const progress = await svc.rotateWithKeys(oldKey, newKey);
    expect(progress.skippedPlaintext).toBe(1);
    expect(progress.rotated).toBe(0);
    expect(updates).toHaveLength(0);
  });
});
