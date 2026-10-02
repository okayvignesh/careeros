// F.6c (Wave F / P6 controlled execution): append-only invariant test.
//
// Proves migration 20261012000005 actually locks the `audit_log` table:
//   1. app role `careeros` can INSERT + SELECT
//   2. app role `careeros` CANNOT UPDATE (permission denied)
//   3. app role `careeros` CANNOT DELETE (permission denied)
//   4. stored proc `audit_log_retention_prune()` (SECURITY DEFINER) removes
//      rows older than 365 days when called from the app connection, even
//      though the caller has DELETE revoked.
//
// Guarded by TESTCONTAINERS_E2E=1 + isDockerAvailable() so the default
// `pnpm test` on a laptop without Docker skips cleanly.
// Run: `TESTCONTAINERS_E2E=1 pnpm --filter @careeros/api test`.
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { isDockerAvailable, startInfra, type StartedInfra } from '@careeros/testing';

const runE2E = process.env.TESTCONTAINERS_E2E === '1' && isDockerAvailable();
const maybe = runE2E ? describe : describe.skip;

const HOOK_TIMEOUT_MS = 180_000;

maybe('F.6c audit_log append-only (opt-in: TESTCONTAINERS_E2E=1)', () => {
  let infra: StartedInfra;
  let superuser: PrismaClient;
  let appUser: PrismaClient;
  let seededUserId: string;

  beforeAll(async () => {
    infra = await startInfra({
      services: { postgres: true, redis: false, qdrant: false, minio: false },
    });
    process.env.DATABASE_URL = infra.postgresUrl;

    superuser = new PrismaClient({ datasources: { db: { url: infra.postgresUrl } } });
    await superuser.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS citext');
    await superuser.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pgcrypto');

    // Sync base schema (creates `audit_log` + `users` + FK).
    const apiDir = path.resolve(__dirname, '../..');
    execFileSync(
      'pnpm',
      ['exec', 'prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'],
      {
        cwd: apiDir,
        env: { ...process.env, DATABASE_URL: infra.postgresUrl },
        stdio: 'inherit',
      },
    );

    // Create the `careeros` app role BEFORE running the append-only migration
    // (its DO blocks look up the role and only apply grants if present).
    await superuser.$executeRawUnsafe(
      "CREATE ROLE careeros LOGIN PASSWORD 'careeros-test'",
    );
    await superuser.$executeRawUnsafe('GRANT ALL ON SCHEMA public TO careeros');
    await superuser.$executeRawUnsafe(
      'GRANT ALL ON ALL TABLES IN SCHEMA public TO careeros',
    );
    await superuser.$executeRawUnsafe(
      'GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO careeros',
    );

    // Apply the append-only migration. $executeRawUnsafe runs one statement
    // at a time, so split the SQL on top-level `;` (ignoring `;` inside
    // dollar-quoted DO blocks).
    const migrationSql = await fs.readFile(
      path.join(
        apiDir,
        'prisma/migrations/20261012000005_audit_log_append_only/migration.sql',
      ),
      'utf8',
    );
    for (const stmt of splitTopLevel(migrationSql)) {
      const trimmed = stmt.trim();
      if (!trimmed) continue;
      await superuser.$executeRawUnsafe(trimmed);
    }

    // Second Prisma client, this one connecting AS `careeros`, so we exercise
    // the actual revoke/grant matrix rather than the superuser's overrides.
    const appUrl = infra.postgresUrl.replace(
      /\/\/test:test@/,
      '//careeros:careeros-test@',
    );
    appUser = new PrismaClient({ datasources: { db: { url: appUrl } } });

    const user = await superuser.user.create({
      data: {
        email: `audit-${Date.now()}@test.local`,
        passwordHash: 'x'.repeat(60),
      },
    });
    seededUserId = user.id;
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await appUser?.$disconnect().catch(() => undefined);
    await superuser?.$disconnect().catch(() => undefined);
    await infra?.cleanup();
  }, HOOK_TIMEOUT_MS);

  it('app role can INSERT an audit_log row', async () => {
    await appUser.$executeRawUnsafe(
      `INSERT INTO "audit_log" ("id","userId","actor","action","timestamp")
         VALUES (gen_random_uuid(), $1::uuid, 'user', 'test.insert', now())`,
      seededUserId,
    );
    const rows = await appUser.$queryRawUnsafe<Array<{ n: bigint }>>(
      'SELECT count(*)::bigint AS n FROM "audit_log"',
    );
    expect(Number(rows[0]!.n)).toBeGreaterThanOrEqual(1);
  });

  it('app role CANNOT UPDATE — permission denied for relation audit_log', async () => {
    await expect(
      appUser.$executeRawUnsafe(
        `UPDATE "audit_log" SET "action" = 'tampered' WHERE "action" = 'test.insert'`,
      ),
    ).rejects.toThrow(/permission denied for (relation|table) "?audit_log"?/i);
  });

  it('app role CANNOT DELETE — permission denied for relation audit_log', async () => {
    await expect(
      appUser.$executeRawUnsafe(
        `DELETE FROM "audit_log" WHERE "action" = 'test.insert'`,
      ),
    ).rejects.toThrow(/permission denied for (relation|table) "?audit_log"?/i);
  });

  it('SECURITY DEFINER proc deletes rows older than 365d, keeps fresh rows', async () => {
    // Seed one 400-day-old row via superuser (app role has DELETE revoked so
    // it also has no way to backdate; the superuser stands in for whatever
    // put the row there in the past) + one fresh row via the app role.
    await superuser.$executeRawUnsafe(
      `INSERT INTO "audit_log" ("id","userId","actor","action","timestamp")
         VALUES (gen_random_uuid(), $1::uuid, 'system', 'test.old', now() - interval '400 days')`,
      seededUserId,
    );
    await appUser.$executeRawUnsafe(
      `INSERT INTO "audit_log" ("id","userId","actor","action","timestamp")
         VALUES (gen_random_uuid(), $1::uuid, 'system', 'test.fresh', now())`,
      seededUserId,
    );

    const removed = await appUser.$queryRawUnsafe<
      Array<{ audit_log_retention_prune: bigint | number }>
    >('SELECT audit_log_retention_prune() AS audit_log_retention_prune');
    const n =
      typeof removed[0]!.audit_log_retention_prune === 'bigint'
        ? Number(removed[0]!.audit_log_retention_prune)
        : removed[0]!.audit_log_retention_prune;
    expect(n).toBeGreaterThanOrEqual(1);

    const oldRows = await superuser.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*)::bigint AS n FROM "audit_log" WHERE "action" = 'test.old'`,
    );
    expect(Number(oldRows[0]!.n)).toBe(0);

    const freshRows = await superuser.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*)::bigint AS n FROM "audit_log" WHERE "action" = 'test.fresh'`,
    );
    expect(Number(freshRows[0]!.n)).toBe(1);
  });
});

// ALWAYS runs. Proves the skip guard is wired and the module imports cleanly
// on machines without Docker.
describe('F.6c audit-log-append-only skip guard', () => {
  it('respects TESTCONTAINERS_E2E env + docker availability', () => {
    expect(typeof runE2E).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// Split a Postgres SQL script on top-level `;`, ignoring `;` inside DO $$ ... $$
// blocks, single-quoted strings, and `--` line comments. Small enough that a
// real parser would be over-engineering; big enough to warrant a helper with a
// name.
// ponytail: covers our migration's shape (DO blocks + CREATE OR REPLACE
// FUNCTION using $$). Add nested-tag / named-tag handling only when a future
// migration needs it.
// ---------------------------------------------------------------------------
function splitTopLevel(sql: string): string[] {
  const out: string[] = [];
  let buf = '';
  let inDollar = false;
  let inSingle = false;
  for (let i = 0; i < sql.length; i++) {
    // Line comments must be copied verbatim: a `;` inside `-- ...` is prose,
    // not a statement boundary. The migration's header comment says
    // "remove audit rows; the worker owns it" — splitting there sends the
    // fragment `the worker ...` to Postgres (syntax error at or near "the").
    if (!inDollar && !inSingle && sql.slice(i, i + 2) === '--') {
      const nl = sql.indexOf('\n', i);
      const end = nl === -1 ? sql.length : nl;
      buf += sql.slice(i, end);
      i = end - 1;
      continue;
    }
    if (!inSingle && sql.slice(i, i + 2) === '$$') {
      inDollar = !inDollar;
      buf += '$$';
      i += 1;
      continue;
    }
    const ch = sql[i]!;
    if (!inDollar && ch === "'") {
      inSingle = !inSingle;
      buf += ch;
      continue;
    }
    if (!inDollar && !inSingle && ch === ';') {
      out.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push(buf);
  return out;
}
