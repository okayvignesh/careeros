// Truncate every user table + reset sequences. For integration tests that
// re-use a container across files, call this in `beforeEach` instead of
// tearing down the container.
//
// Prisma's client is intentionally typed as `unknown` to keep this package
// free of a `@prisma/client` dep; callers pass their own client.
//
// Usage:
//   import { resetDb } from '@careeros/testing';
//   beforeEach(() => resetDb(prisma));
export interface HasRawSql {
  $queryRawUnsafe: (sql: string) => Promise<unknown>;
  $executeRawUnsafe: (sql: string) => Promise<unknown>;
}

interface TableRow {
  tablename: string;
}
interface SeqRow {
  sequence_name: string;
}

export async function resetDb(prisma: HasRawSql): Promise<void> {
  const tables = (await prisma.$queryRawUnsafe(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma_%'`,
  )) as TableRow[];

  if (tables.length > 0) {
    // Single TRUNCATE handles FK cycles + resets identity in one lock.
    const names = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`);
  }

  // Any bare sequences (not tied to a table via IDENTITY) still need a manual
  // reset; TRUNCATE ... RESTART IDENTITY only touches owned sequences.
  const sequences = (await prisma.$queryRawUnsafe(
    `SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public'`,
  )) as SeqRow[];

  for (const s of sequences) {
    await prisma.$executeRawUnsafe(`ALTER SEQUENCE "public"."${s.sequence_name}" RESTART WITH 1`);
  }
}
