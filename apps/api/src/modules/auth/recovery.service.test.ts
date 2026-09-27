import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { RecoveryCodesService, normalizeCode } from './recovery.service';

type Row = { id: string; userId: string; codeHash: string; usedAt: Date | null };

function fakePrisma(userExists: boolean) {
  const rows: Row[] = [];
  return {
    calls: { rows },
    user: {
      findUnique: async ({ where }: { where: { email: string } }) =>
        userExists && where.email === 'a@b.com' ? { id: 'user-1' } : null,
    },
    recoveryCode: {
      deleteMany: async ({ where }: { where: { userId: string; usedAt: null } }) => {
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i--) {
          if (rows[i].userId === where.userId && rows[i].usedAt === null) rows.splice(i, 1);
        }
        return { count: before - rows.length };
      },
      createMany: async ({ data }: { data: Array<{ userId: string; codeHash: string }> }) => {
        for (const d of data) {
          rows.push({ id: `code-${rows.length + 1}`, userId: d.userId, codeHash: d.codeHash, usedAt: null });
        }
        return { count: data.length };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { userId: string; codeHash: string; usedAt: null };
        data: { usedAt: Date };
      }) => {
        const match = rows.find(
          (r) => r.userId === where.userId && r.codeHash === where.codeHash && r.usedAt === null,
        );
        if (!match) return { count: 0 };
        match.usedAt = data.usedAt;
        return { count: 1 };
      },
      count: async ({ where }: { where: { userId: string; usedAt: null } }) =>
        rows.filter((r) => r.userId === where.userId && r.usedAt === null).length,
    },
    $transaction: async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]),
  };
}

function fakeSession() {
  const writes: string[] = [];
  return {
    writes,
    write: vi.fn(async (_res: unknown, userId: string) => {
      writes.push(userId);
      return 'sess';
    }),
  };
}

describe('RecoveryCodesService.generateCodes', () => {
  it('returns N plaintext codes and persists only sha256 hashes', async () => {
    const prisma = fakePrisma(true);
    const svc = new RecoveryCodesService(prisma as never, fakeSession() as never);
    const { codes } = await svc.generateCodes('user-1', 8);
    expect(codes).toHaveLength(8);
    // Display format: xxxx-xxxx-xxxx
    for (const c of codes) {
      expect(c).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    }
    expect(prisma.calls.rows).toHaveLength(8);
    // No plaintext leaked into storage.
    for (const row of prisma.calls.rows) {
      expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
      for (const code of codes) {
        expect(row.codeHash).not.toContain(normalizeCode(code));
      }
    }
    // Uniqueness within the set.
    const uniq = new Set(prisma.calls.rows.map((r) => r.codeHash));
    expect(uniq.size).toBe(8);
    // MUTATION-SMOKE: remove the hashing step (store plaintext) and this
    // regex + contains assertions both go red.
  });

  it('wipes prior unused codes on regeneration', async () => {
    const prisma = fakePrisma(true);
    const svc = new RecoveryCodesService(prisma as never, fakeSession() as never);
    await svc.generateCodes('user-1', 4);
    expect(prisma.calls.rows).toHaveLength(4);
    await svc.generateCodes('user-1', 4);
    // Old 4 wiped, new 4 added → still 4.
    expect(prisma.calls.rows).toHaveLength(4);
  });
});

describe('RecoveryCodesService.redeemCode', () => {
  it('redeems a matching code case-insensitively and mints a session', async () => {
    const prisma = fakePrisma(true);
    const session = fakeSession();
    const svc = new RecoveryCodesService(prisma as never, session as never);
    const { codes } = await svc.generateCodes('user-1', 3);
    const code = codes[0]; // "XXXX-XXXX-XXXX"
    // Mangle: lowercase + drop hyphens + inject whitespace. Should still match.
    const mangled = ` ${code.toLowerCase().replace(/-/g, '')} `;
    const out = await svc.redeemCode('a@b.com', mangled, {} as never);
    expect(out.userId).toBe('user-1');
    expect(session.writes).toEqual(['user-1']);
  });

  it('rejects an already-used code', async () => {
    const prisma = fakePrisma(true);
    const svc = new RecoveryCodesService(prisma as never, fakeSession() as never);
    const { codes } = await svc.generateCodes('user-1', 2);
    const code = codes[0];
    await svc.redeemCode('a@b.com', code, {} as never);
    // Second redeem of the same code → 401.
    await expect(svc.redeemCode('a@b.com', code, {} as never)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    // MUTATION-SMOKE: comment out the `usedAt: null` filter in updateMany
    // and this test starts passing on the second redeem → red.
  });

  it('rejects an unknown code (never issued)', async () => {
    const prisma = fakePrisma(true);
    const svc = new RecoveryCodesService(prisma as never, fakeSession() as never);
    await svc.generateCodes('user-1', 1);
    await expect(svc.redeemCode('a@b.com', 'ZZZZ-ZZZZ-ZZZZ', {} as never)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects when the email does not resolve to a user', async () => {
    const prisma = fakePrisma(false);
    const svc = new RecoveryCodesService(prisma as never, fakeSession() as never);
    await expect(svc.redeemCode('nope@b.com', 'AAAA-BBBB-CCCC', {} as never)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('email lookup is case + NFC normalized (via normalizeEmail)', async () => {
    const prisma = fakePrisma(true);
    const svc = new RecoveryCodesService(prisma as never, fakeSession() as never);
    const { codes } = await svc.generateCodes('user-1', 1);
    // Uppercase email should still hit `a@b.com`.
    const out = await svc.redeemCode('A@B.COM', codes[0], {} as never);
    expect(out.userId).toBe('user-1');
  });
});

describe('normalizeCode', () => {
  it('uppercases, strips hyphens and whitespace', () => {
    expect(normalizeCode(' abc-def ghi ')).toBe('ABCDEFGHI');
    expect(normalizeCode('AAAA-BBBB-CCCC')).toBe('AAAABBBBCCCC');
  });
});
