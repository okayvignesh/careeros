// Self-test for the migration-safety scaffold.
//
// Exercises the three units the helper exposes:
//   - scanDestructive flags DROP TABLE / ALTER COLUMN ... TYPE / DROP COLUMN
//     and ignores additive statements
//   - snapshotRowCounts + assertMigrationSafety against a FakeDb that mimics
//     the two Prisma raw methods we use ($executeRawUnsafe + $queryRawUnsafe)
//   - end-to-end: a "trivial no-op" migration (CREATE TABLE then DROP TABLE
//     against a scratch schema) exercises both apply paths with
//     allowDestructive=true + reviewedIn
//
// No real database is spun up here. A Prisma / node-postgres consumer in an
// actual migration test wires its own live db; this test proves the harness
// contract against a stub so the scaffold itself can't rot.
import { describe, expect, it } from 'vitest';
import {
  assertMigrationSafety,
  MigrationSafetyError,
  scanDestructive,
  snapshotRowCounts,
  type MinimalDb,
} from './migration-safety';

// --- scanDestructive -------------------------------------------------------

describe('scanDestructive', () => {
  it('returns [] for a purely additive migration', () => {
    const sql = `
      CREATE TABLE "users" ("id" UUID NOT NULL, "email" TEXT NOT NULL);
      CREATE INDEX "users_email_idx" ON "users"("email");
      ALTER TABLE "users" ADD COLUMN "display_name" TEXT;
    `;
    expect(scanDestructive(sql)).toEqual([]);
  });

  it('flags DROP TABLE', () => {
    const sql = `DROP TABLE "legacy_jobs";`;
    const findings = scanDestructive(sql);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe('DROP_TABLE');
    expect(findings[0]!.target).toBe('legacy_jobs');
  });

  it('flags ALTER COLUMN ... TYPE', () => {
    const sql = `ALTER TABLE "users" ALTER COLUMN "age" TYPE INTEGER;`;
    const findings = scanDestructive(sql);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe('ALTER_COLUMN_TYPE');
    expect(findings[0]!.target).toBe('age');
  });

  it('flags DROP COLUMN', () => {
    const sql = `ALTER TABLE "users" DROP COLUMN "legacy_field";`;
    const findings = scanDestructive(sql);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe('DROP_COLUMN');
    expect(findings[0]!.target).toBe('legacy_field');
  });

  it('ignores destructive patterns inside -- line comments', () => {
    const sql = `
      -- DROP TABLE commented_out;
      CREATE TABLE "x" ("id" UUID);
    `;
    expect(scanDestructive(sql)).toEqual([]);
  });

  it('ignores destructive patterns inside /* block */ comments', () => {
    const sql = `
      /* DROP COLUMN gone; */
      CREATE TABLE "x" ("id" UUID);
    `;
    expect(scanDestructive(sql)).toEqual([]);
  });

  it('attaches a plausible line number', () => {
    const sql = `-- header\n-- more\nDROP TABLE "a";\n`;
    const findings = scanDestructive(sql);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.line).toBe(3);
  });
});

// --- FakeDb (in-memory tables) --------------------------------------------
//
// Honours only the three statement shapes the self-test exercises:
//   CREATE TABLE "<name>" (...)   -> add key
//   DROP TABLE "<name>"           -> delete key
//   INSERT INTO "<name>" ...      -> bump row count
//
// Any other statement is a no-op (fine; the real Prisma client is what
// consumers wire in production tests).
function makeFakeDb(): MinimalDb & { tables: Map<string, number> } {
  const tables = new Map<string, number>();
  const db: MinimalDb & { tables: Map<string, number> } = {
    tables,
    async $executeRawUnsafe(sql: string) {
      const create = /CREATE\s+TABLE\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?/i.exec(sql);
      if (create) {
        tables.set(create[1]!, tables.get(create[1]!) ?? 0);
        return 1;
      }
      const drop = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/i.exec(sql);
      if (drop) {
        tables.delete(drop[1]!);
        return 1;
      }
      const insert = /INSERT\s+INTO\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?/i.exec(sql);
      if (insert) {
        const name = insert[1]!;
        tables.set(name, (tables.get(name) ?? 0) + 1);
        return 1;
      }
      const del = /DELETE\s+FROM\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?/i.exec(sql);
      if (del) {
        tables.set(del[1]!, 0);
        return 1;
      }
      return 0;
    },
    async $queryRawUnsafe<T = unknown>(sql: string): Promise<T> {
      // information_schema.tables lookup
      if (/information_schema\.tables/i.test(sql)) {
        return Array.from(tables.keys()).map((table_name) => ({ table_name })) as T;
      }
      // SELECT COUNT(*) FROM "public"."<name>"
      const count = /FROM\s+"[^"]+"\."([^"]+)"/i.exec(sql);
      if (count) {
        return [{ n: tables.get(count[1]!) ?? 0 }] as T;
      }
      return [] as T;
    },
  };
  return db;
}

// --- snapshotRowCounts -----------------------------------------------------

describe('snapshotRowCounts', () => {
  it('returns a count per existing table in the given schema', async () => {
    const db = makeFakeDb();
    await db.$executeRawUnsafe('CREATE TABLE "a" (x int)');
    await db.$executeRawUnsafe('CREATE TABLE "b" (x int)');
    await db.$executeRawUnsafe('INSERT INTO "a" VALUES (1)');
    await db.$executeRawUnsafe('INSERT INTO "a" VALUES (2)');
    await db.$executeRawUnsafe('INSERT INTO "b" VALUES (1)');

    const counts = await snapshotRowCounts(db);
    expect(counts.get('public.a')).toBe(2);
    expect(counts.get('public.b')).toBe(1);
  });
});

// --- assertMigrationSafety -------------------------------------------------

describe('assertMigrationSafety', () => {
  it('passes for a purely additive migration', async () => {
    const db = makeFakeDb();
    await db.$executeRawUnsafe('CREATE TABLE "existing" (x int)');
    await db.$executeRawUnsafe('INSERT INTO "existing" VALUES (1)');

    await expect(
      assertMigrationSafety('20260101000000_add_new_table', {
        sql: `CREATE TABLE "new_feature" ("id" UUID NOT NULL);`,
        db,
      }),
    ).resolves.toBeUndefined();

    expect(db.tables.has('new_feature')).toBe(true);
    expect(db.tables.get('existing')).toBe(1);
  });

  it('refuses a destructive migration without allowDestructive', async () => {
    const db = makeFakeDb();
    await db.$executeRawUnsafe('CREATE TABLE "old_table" (x int)');

    await expect(
      assertMigrationSafety('20260101000000_drop_old', {
        sql: `DROP TABLE "old_table";`,
        db,
      }),
    ).rejects.toBeInstanceOf(MigrationSafetyError);
  });

  it('refuses allowDestructive without reviewedIn', async () => {
    const db = makeFakeDb();
    await db.$executeRawUnsafe('CREATE TABLE "old_table" (x int)');

    await expect(
      assertMigrationSafety('20260101000000_drop_old', {
        sql: `DROP TABLE "old_table";`,
        db,
        allowDestructive: true,
      }),
    ).rejects.toThrow(/reviewedIn/);
  });

  it('accepts a destructive migration when allowDestructive + reviewedIn are both set', async () => {
    const db = makeFakeDb();
    await db.$executeRawUnsafe('CREATE TABLE "old_table" (x int)');

    await assertMigrationSafety('20260101000000_drop_old', {
      sql: `DROP TABLE "old_table";`,
      db,
      allowDestructive: true,
      reviewedIn: 'CAREEROS-123',
    });
    expect(db.tables.has('old_table')).toBe(false);
  });

  it('fails when the migration silently drops rows in an existing table', async () => {
    const db = makeFakeDb();
    await db.$executeRawUnsafe('CREATE TABLE "orders" (x int)');
    await db.$executeRawUnsafe('INSERT INTO "orders" VALUES (1)');
    await db.$executeRawUnsafe('INSERT INTO "orders" VALUES (2)');

    await expect(
      assertMigrationSafety('20260101000000_truncate_orders', {
        sql: `DELETE FROM "orders";`,
        db,
      }),
    ).rejects.toMatchObject({
      name: 'MigrationSafetyError',
      rowLoss: [{ table: 'public.orders', before: 2, after: 0 }],
    });
  });

  it('runs the before + after hooks around the migration', async () => {
    const db = makeFakeDb();
    const order: string[] = [];

    await assertMigrationSafety('20260101000000_add_col', {
      sql: `CREATE TABLE "fresh" ("id" UUID);`,
      db,
      before: async () => {
        order.push('before');
      },
      after: async () => {
        order.push('after');
      },
    });
    expect(order).toEqual(['before', 'after']);
  });

  it('end-to-end: trivial no-op (create + drop a scratch table against a fresh db)', async () => {
    const db = makeFakeDb();
    // No seed data; purely a shape check that the harness tolerates a
    // migration whose net effect is zero but whose body is destructive.
    await assertMigrationSafety('20260101000000_scratch_noop', {
      sql: `
        CREATE TABLE "scratch" ("id" UUID NOT NULL);
        DROP TABLE "scratch";
      `,
      db,
      allowDestructive: true,
      reviewedIn: 'self-test',
    });
    expect(db.tables.has('scratch')).toBe(false);
  });
});
