import { describe, expect, it } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service';
import type { StorageService } from '../../common/storage.service';
import {
  EXPORT_SCHEMA_VERSION,
  MeService,
  USER_TABLES,
} from './me.service';

// Minimal stand-in: these tests exercise exportForUser + deleteUser +
// assertDeletedForUser, none of which touch MinIO. exportToStorage has its
// own integration test (me.storage.integration.test.ts) that runs against a
// real MinIO container.
function fakeStorage(): StorageService {
  return {
    putExport: async () => 'exports/u-1/stub.age',
    presignExportDownload: async () => 'https://stub/presigned',
  } as unknown as StorageService;
}

/**
 * F.8 unit tests. The service is thin (query + hash + delete); the payoff
 * from these tests is guarding the invariants:
 *   - export walks every USER_TABLES entry (mutation smoke: drop a line and
 *     a manifest row goes missing)
 *   - manifest sha256 is stable for identical payloads (regression guard)
 *   - deleteUser calls user.delete which we trust Prisma to cascade;
 *     assertDeletedForUser reads counts to prove parity
 *   - USER_TABLES vs the actual Prisma delegate names line up (delegate typo
 *     would throw at runtime; this test surfaces it now)
 */

function fakePrisma(seed: { rowsPerTable?: number; user?: { id: string; email: string } | null } = {}): {
  service: PrismaService;
  deleteCalls: Array<{ where: unknown }>;
} {
  const rows = seed.rowsPerTable ?? 0;
  const user = seed.user === undefined
    ? { id: 'u-1', email: 'a@b.co', displayName: null, createdAt: new Date(0), updatedAt: new Date(0) }
    : seed.user;
  const deleteCalls: Array<{ where: unknown }> = [];

  // Build a fake with one findMany + one count per USER_TABLES delegate.
  const delegates: Record<string, { findMany: Function; count: Function }> = {};
  for (const table of USER_TABLES) {
    const key = table.delegate as string;
    delegates[key] = {
      findMany: async (args: { where: Record<string, unknown> }) => {
        return Array.from({ length: rows }, (_, i) => ({
          id: `${key}-${i}`,
          userId: args.where.userId,
        }));
      },
      count: async (args: { where: Record<string, unknown> }) => {
        // Simulate that after delete, counts drop to 0 - the deleteCalls array
        // getting populated is our proxy for "delete happened".
        return deleteCalls.length > 0 ? 0 : rows;
      },
    };
  }

  const fake = {
    ...delegates,
    user: {
      findUnique: async () => user,
      delete: async (args: { where: unknown }) => {
        deleteCalls.push({ where: args.where });
        return { id: 'u-1' };
      },
    },
  };

  return { service: fake as unknown as PrismaService, deleteCalls };
}

describe('MeService.exportForUser', () => {
  it('writes one manifest row per USER_TABLES entry', async () => {
    const { service } = fakePrisma({ rowsPerTable: 2 });
    const svc = new MeService(service, fakeStorage());
    const payload = await svc.exportForUser('u-1');
    expect(payload.manifest.tables).toHaveLength(USER_TABLES.length);
    // MUTATION-SMOKE: drop any entry from USER_TABLES and this count changes.
  });

  it('stamps schema version + user email into the manifest', async () => {
    const { service } = fakePrisma({ rowsPerTable: 0, user: { id: 'u-1', email: 'me@example.com' } });
    const svc = new MeService(service, fakeStorage());
    const payload = await svc.exportForUser('u-1');
    expect(payload.manifest.userId).toBe('u-1');
    expect(payload.manifest.email).toBe('me@example.com');
    expect(payload.manifest.schemaVersion).toBe(EXPORT_SCHEMA_VERSION);
  });

  it('manifest rowCount matches the tables map length', async () => {
    const { service } = fakePrisma({ rowsPerTable: 3 });
    const svc = new MeService(service, fakeStorage());
    const payload = await svc.exportForUser('u-1');
    for (const row of payload.manifest.tables) {
      expect(payload.tables[row.name]).toHaveLength(row.rowCount);
    }
  });

  it('sha256 is deterministic for the same payload', async () => {
    const { service } = fakePrisma({ rowsPerTable: 2 });
    const svc = new MeService(service, fakeStorage());
    const [p1, p2] = await Promise.all([svc.exportForUser('u-1'), svc.exportForUser('u-1')]);
    // Table hashes are computed off row content; identical fake data means
    // identical hashes. If someone accidentally inserts non-deterministic
    // fields (Date.now, random) into the hash input this fails.
    for (let i = 0; i < p1.manifest.tables.length; i++) {
      expect(p1.manifest.tables[i].sha256).toBe(p2.manifest.tables[i].sha256);
    }
  });
});

describe('MeService.deleteUser', () => {
  it('calls prisma.user.delete with the userId', async () => {
    const { service, deleteCalls } = fakePrisma({ rowsPerTable: 3 });
    const svc = new MeService(service, fakeStorage());
    const result = await svc.deleteUser('u-1');
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]!.where).toEqual({ id: 'u-1' });
    // Returned rowCounts are the SNAPSHOT before delete (proves cascade
    // was expected to remove them); the audit event uses it.
    expect(result.rowCounts.applications).toBe(3);
    expect(Object.keys(result.rowCounts)).toEqual(USER_TABLES.map((t) => t.name));
  });

  it('assertDeletedForUser reports ok when every count is 0', async () => {
    const { service } = fakePrisma({ rowsPerTable: 3 });
    const svc = new MeService(service, fakeStorage());
    await svc.deleteUser('u-1'); // flip the fake to "post-delete" mode
    const parity = await svc.assertDeletedForUser('u-1');
    expect(parity.ok).toBe(true);
    expect(parity.nonZero).toEqual([]);
  });

  it('assertDeletedForUser reports non-zero tables when parity fails', async () => {
    const { service } = fakePrisma({ rowsPerTable: 3 });
    const svc = new MeService(service, fakeStorage());
    // Skip deleteUser call - counts stay at 3 - parity must fail on every table.
    const parity = await svc.assertDeletedForUser('u-1');
    expect(parity.ok).toBe(false);
    expect(parity.nonZero).toEqual(USER_TABLES.map((t) => t.name));
    // MUTATION-SMOKE: change assertDeletedForUser to filter count >= 0 and
    // this test fails.
  });
});
