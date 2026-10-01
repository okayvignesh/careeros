// testing.md item 6: migration forward-safety per-migration test scaffold.
//
// Each new migration under apps/api/prisma/migrations/ gets its own tiny
// test file that:
//
//   import { assertMigrationSafety } from '@careeros/testing';
//   it('is forward-safe', async () => {
//     await assertMigrationSafety('<migration-name>', {
//       sql: readFileSync(migrationPath, 'utf8'),
//       before: async (db) => { ...seed... },
//       after:  async (db) => { ...assert counts... },
//       db,
//     });
//   });
//
// This file is the HARNESS. It does NOT apply migrations on its own, and it
// does not run against the real prod schema. The caller supplies:
//
//   - sql       : the migration SQL text (so we can scan it statically for
//                 destructive patterns BEFORE touching the db)
//   - before(db): seed the throwaway database copy
//   - after(db) : custom assertions after the migration applied
//   - db        : a minimal RawSql-shaped client (same shape as resetDb's
//                 HasRawSql); any Prisma / Kysely / node-postgres wrapper
//                 that can run `$executeRawUnsafe(string)` and
//                 `$queryRawUnsafe<T>(string)` works
//
// What the scaffold does:
//
//   1. STATIC SCAN: flags DROP TABLE, ALTER COLUMN ... TYPE, ALTER TABLE
//      ... DROP COLUMN as require-manual-review. These are legal migrations,
//      but they are the three shapes that silently lose data if applied
//      without a backfill. The scaffold refuses to run them unless the
//      caller opts in via `{ allowDestructive: true }` and names the review
//      ticket in `reviewedIn`.
//
//   2. ROW-COUNT SNAPSHOT: counts rows per public table BEFORE and AFTER
//      the migration applies. Any table whose count DECREASES fails the
//      test. (A table that disappears entirely is caught by the static
//      scan above.)
//
//   3. HAND-OFF: calls the caller's `after(db)` for migration-specific
//      shape checks (new column exists, index present, value backfilled,
//      etc.) that only the migration author knows.
//
// ponytail: no CLI, no magical auto-discovery, no "run every migration in
// order" harness. One migration = one test file calls this function. If a
// future audit needs the matrix form, loop over readdirSync of the
// migrations dir and call this per entry.

export interface MinimalDb {
  $executeRawUnsafe(sql: string): Promise<unknown>;
  $queryRawUnsafe<T = unknown>(sql: string): Promise<T>;
}

export interface AssertMigrationSafetyOptions {
  /** Raw SQL of the migration (readFileSync of migration.sql). */
  sql: string;
  /** Seed hook. Runs against the schema BEFORE the migration applies. */
  before?: (db: MinimalDb) => Promise<void>;
  /** Assertion hook. Runs against the schema AFTER the migration applies. */
  after?: (db: MinimalDb) => Promise<void>;
  /**
   * Any client that exposes $executeRawUnsafe + $queryRawUnsafe. PrismaClient
   * fits natively; node-postgres can be adapted with a 10-line wrapper.
   */
  db: MinimalDb;
  /**
   * Set to true for migrations that intentionally drop columns / tables or
   * change column types. The caller must also set `reviewedIn` naming the
   * review ticket / PR that signed off on the data-loss shape.
   */
  allowDestructive?: boolean;
  reviewedIn?: string;
  /**
   * Schema name to snapshot row counts for. Default 'public'. Set to null
   * to skip the row-count snapshot entirely (useful for CREATE-only
   * migrations against an empty database).
   */
  schema?: string | null;
}

export interface DestructiveFinding {
  kind: 'DROP_TABLE' | 'ALTER_COLUMN_TYPE' | 'DROP_COLUMN';
  target: string;
  line: number;
}

/**
 * Scans migration SQL for the three shapes that silently drop data:
 *   - `DROP TABLE <name>`
 *   - `ALTER TABLE <t> ... ALTER COLUMN <c> TYPE <newtype>`  (narrowing casts lose rows)
 *   - `ALTER TABLE <t> ... DROP COLUMN <c>`
 *
 * Returns [] when the migration is purely additive (CREATE TABLE / CREATE
 * INDEX / ADD COLUMN / ADD CONSTRAINT / ALTER COLUMN SET DEFAULT / etc.).
 */
export function scanDestructive(sql: string): DestructiveFinding[] {
  const findings: DestructiveFinding[] = [];
  // Strip SQL -- line comments and /* block */ comments so matches aren't
  // triggered by documentation.
  const stripped = sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');

  const patterns: Array<{
    kind: DestructiveFinding['kind'];
    re: RegExp;
  }> = [
    {
      kind: 'DROP_TABLE',
      re: /\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?["']?([a-zA-Z_][a-zA-Z0-9_."]*)["']?/gi,
    },
    {
      kind: 'ALTER_COLUMN_TYPE',
      // Postgres: ALTER TABLE t ALTER COLUMN c TYPE new_type
      re: /\bALTER\s+TABLE\s+[^;]*?\bALTER\s+COLUMN\s+["']?([a-zA-Z_][a-zA-Z0-9_]*)["']?\s+(?:SET\s+DATA\s+)?TYPE\b/gi,
    },
    {
      kind: 'DROP_COLUMN',
      re: /\bALTER\s+TABLE\s+[^;]*?\bDROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?["']?([a-zA-Z_][a-zA-Z0-9_]*)["']?/gi,
    },
  ];

  for (const { kind, re } of patterns) {
    for (const m of stripped.matchAll(re)) {
      const idx = m.index ?? 0;
      // Line number = count of newlines before the match + 1.
      const line = stripped.slice(0, idx).split('\n').length;
      // Strip any trailing quote / schema prefix the greedy identifier capture
      // may have swept in.
      const target = (m[1] ?? '<unknown>').replace(/["']/g, '').split('.').pop() ?? '<unknown>';
      findings.push({ kind, target, line });
    }
  }

  return findings;
}

/**
 * Snapshot row counts for every table in `schema`. Returns a Map
 * keyed by `<schema>.<table>` with the integer row count. Tables that
 * do not yet exist (or no longer exist) are simply absent from the map.
 */
export async function snapshotRowCounts(
  db: MinimalDb,
  schema = 'public',
): Promise<Map<string, number>> {
  const tables = await db.$queryRawUnsafe<Array<{ table_name: string }>>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = '${schema.replace(/'/g, "''")}' AND table_type = 'BASE TABLE'`,
  );
  const counts = new Map<string, number>();
  for (const row of tables ?? []) {
    const name = row.table_name;
    // Count via COUNT(*). Safe here because the only inputs are
    // information_schema results against a schema the caller named.
    const result = await db.$queryRawUnsafe<Array<{ n: bigint | number | string }>>(
      `SELECT COUNT(*)::bigint AS n FROM "${schema}"."${name.replace(/"/g, '""')}"`,
    );
    const n = result?.[0]?.n;
    counts.set(`${schema}.${name}`, Number(n ?? 0));
  }
  return counts;
}

export class MigrationSafetyError extends Error {
  constructor(
    message: string,
    public readonly findings?: DestructiveFinding[],
    public readonly rowLoss?: Array<{ table: string; before: number; after: number }>,
  ) {
    super(message);
    this.name = 'MigrationSafetyError';
  }
}

/**
 * Core harness. Runs `before`, applies the migration SQL, then runs `after`
 * and compares row counts. See file header for the full contract.
 */
export async function assertMigrationSafety(
  migrationName: string,
  opts: AssertMigrationSafetyOptions,
): Promise<void> {
  const { sql, before, after, db, allowDestructive = false, reviewedIn, schema = 'public' } = opts;

  // 1. Static scan.
  const findings = scanDestructive(sql);
  if (findings.length > 0 && !allowDestructive) {
    const lines = findings
      .map((f) => `  - ${f.kind} ${f.target} at line ${f.line}`)
      .join('\n');
    throw new MigrationSafetyError(
      `Migration ${migrationName} contains destructive statements. Mark allowDestructive: true and reviewedIn: "<ticket>" to proceed.\n${lines}`,
      findings,
    );
  }
  if (findings.length > 0 && allowDestructive && !reviewedIn) {
    throw new MigrationSafetyError(
      `Migration ${migrationName} is destructive and allowDestructive=true; set reviewedIn to name the review ticket.`,
      findings,
    );
  }

  // 2. Seed + snapshot before.
  if (before) await before(db);
  const countsBefore = schema === null ? new Map<string, number>() : await snapshotRowCounts(db, schema);

  // 3. Apply the migration. Split on semicolons and apply statement-by-
  //    statement so the first failure surfaces with the offending stmt.
  //    ponytail: naive splitter. If a migration ever embeds `;` inside a
  //    DO $$ ... $$ block, pre-strip those blocks or run them separately.
  const statements = sql
    .split(/;\s*(?=\r?\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^--/.test(s));

  for (const stmt of statements) {
    await db.$executeRawUnsafe(stmt);
  }

  // 4. Snapshot after + compare.
  const rowLoss: Array<{ table: string; before: number; after: number }> = [];
  if (schema !== null) {
    const countsAfter = await snapshotRowCounts(db, schema);
    for (const [table, before] of countsBefore.entries()) {
      const after = countsAfter.get(table);
      if (after === undefined) {
        // Table vanished. Already caught by the static scan unless
        // allowDestructive, in which case the caller signed off.
        if (!allowDestructive) {
          rowLoss.push({ table, before, after: 0 });
        }
        continue;
      }
      if (after < before) {
        rowLoss.push({ table, before, after });
      }
    }
    if (rowLoss.length > 0) {
      const lines = rowLoss
        .map((r) => `  - ${r.table}: ${r.before} -> ${r.after}`)
        .join('\n');
      throw new MigrationSafetyError(
        `Migration ${migrationName} lost rows in one or more tables.\n${lines}`,
        findings,
        rowLoss,
      );
    }
  }

  // 5. Caller-defined post-conditions.
  if (after) await after(db);
}
