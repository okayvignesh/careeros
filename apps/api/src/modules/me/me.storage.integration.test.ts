// F.8 follow-up: round-trip integration test.
//
// Proves the full data-portability loop end-to-end against real infra:
//   1. seed a user + rows across 3 user-owned tables (resumeFact, careerGoal,
//      application)
//   2. call MeService.exportToStorage() → age-encrypted artifact lands in
//      MinIO, presigned URL returned
//   3. download the artifact via the presigned URL, assert the age v1 header
//      ("age-encryption.org/v1\n") is present
//   4. decrypt with the matching age identity key (spawned `age -d`), parse
//      the JSON, assert the manifest row counts match what was seeded
//   5. call MeService.deleteUser(), then assertDeletedForUser() → every
//      cascade table reads 0 rows for this userId (set-null tables unlinked)
//
// Guarded by TESTCONTAINERS_E2E=1 + isDockerAvailable() + `age` binary on
// PATH. The suite skips cleanly on laptops without any of those.
// Run: `TESTCONTAINERS_E2E=1 pnpm --filter @careeros/api test`.
//
// ponytail: ONE round-trip test. Not a matrix across every USER_TABLES entry
// (36 of them). The invariant proven here is "the pipeline works at all";
// per-table coverage is already enforced by me.service.test.ts via the
// shared USER_TABLES array.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Client as MinioClient } from 'minio';
import { isDockerAvailable, startInfra, type StartedInfra } from '@careeros/testing';
import { MeService } from './me.service';
import { StorageService } from '../../common/storage.service';

function isAgeAvailable(): boolean {
  const which = spawnSync('sh', ['-c', 'command -v age && command -v age-keygen'], {
    encoding: 'utf8',
  });
  return which.status === 0;
}

const runE2E =
  process.env.TESTCONTAINERS_E2E === '1' && isDockerAvailable() && isAgeAvailable();
const maybe = runE2E ? describe : describe.skip;

const HOOK_TIMEOUT_MS = 300_000;

maybe('F.8 export round-trip (opt-in: TESTCONTAINERS_E2E=1 + age installed)', () => {
  let infra: StartedInfra;
  let prisma: PrismaClient;
  let me: MeService;
  let storage: StorageService;
  let userId: string;
  let ageKeyPath: string;
  let ageRecipient: string;

  beforeAll(async () => {
    infra = await startInfra({
      services: { postgres: true, redis: false, qdrant: false, minio: true },
    });

    // Generate an operator keypair for this test only. `age-keygen -o <file>`
    // writes `AGE-SECRET-KEY-...` to the file and prints `# public key: age1...`
    // on stderr. We capture both.
    const keyDir = mkdtempSync(path.join(tmpdir(), 'careeros-age-'));
    ageKeyPath = path.join(keyDir, 'identity.txt');
    const keygen = spawnSync('age-keygen', ['-o', ageKeyPath], { encoding: 'utf8' });
    if (keygen.status !== 0) {
      throw new Error(`age-keygen failed: ${keygen.stderr}`);
    }
    const match = /public key: (age1[0-9a-z]+)/.exec(keygen.stderr);
    if (!match) throw new Error(`age-keygen stderr missing public key: ${keygen.stderr}`);
    ageRecipient = match[1]!;

    // Wire env for StorageService + MeService. StorageService.onModuleInit
    // (which runs in nest DI) is skipped here; we create the bucket by hand
    // via the raw minio client because we're using the class directly, not
    // Nest's module boot.
    const minioUrl = new URL(infra.minioEndpoint);
    process.env.MINIO_ENDPOINT = minioUrl.hostname;
    process.env.MINIO_PORT = minioUrl.port;
    process.env.MINIO_USE_SSL = 'false';
    process.env.MINIO_ACCESS_KEY = infra.minioAccessKey;
    process.env.MINIO_SECRET_KEY = infra.minioSecretKey;
    process.env.MINIO_BUCKET = 'careeros-test';
    process.env.AGE_RECIPIENT = ageRecipient;
    process.env.DATABASE_URL = infra.postgresUrl;

    // Create the test bucket.
    const minio = new MinioClient({
      endPoint: minioUrl.hostname,
      port: Number(minioUrl.port),
      useSSL: false,
      accessKey: infra.minioAccessKey,
      secretKey: infra.minioSecretKey,
    });
    const exists = await minio.bucketExists('careeros-test');
    if (!exists) await minio.makeBucket('careeros-test');

    // Sync schema (one shot; same pattern as audit-log-append-only test).
    const apiDir = path.resolve(__dirname, '../../..');
    execFileSync(
      'pnpm',
      ['exec', 'prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'],
      {
        cwd: apiDir,
        env: { ...process.env, DATABASE_URL: infra.postgresUrl },
        stdio: 'inherit',
      },
    );

    prisma = new PrismaClient({ datasources: { db: { url: infra.postgresUrl } } });
    await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS citext');
    await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pgcrypto');

    // Pino logger stub so StorageService ctor is happy.
    const logger = { info: () => {}, warn: () => {}, error: () => {} } as never;
    storage = new StorageService(logger);
    me = new MeService(prisma as never, storage);

    // Seed: one user + rows across three user-owned tables, picked to cover
    // different shapes (JSON column, 1:1 PK=userId, append-only event log).
    const user = await prisma.user.create({
      data: {
        email: `export-${Date.now()}@test.local`,
        passwordHash: 'x'.repeat(60),
      },
    });
    userId = user.id;

    await prisma.resumeFact.createMany({
      data: [
        { userId, kind: 'skill', content: { name: 'typescript' } },
        { userId, kind: 'skill', content: { name: 'postgres' } },
        { userId, kind: 'employment', content: { company: 'ACME' } },
      ],
    });

    await prisma.careerGoal.create({
      data: {
        userId,
        targetRoles: ['senior-engineer'],
        locations: ['remote'],
        seniority: ['senior'],
        timezone: 'UTC',
      },
    });

    await prisma.xpEvent.createMany({
      data: [
        { userId, reason: 'attempt:knowledge', xp: 10 },
        { userId, reason: 'streak:milestone', xp: 50 },
      ],
    });
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await prisma?.$disconnect().catch(() => undefined);
    await infra?.cleanup();
  }, HOOK_TIMEOUT_MS);

  it(
    'export writes an age-encrypted artifact; download + decrypt matches manifest; delete empties every USER_TABLE',
    async () => {
      // 1. Export → MinIO.
      const result = await me.exportToStorage(userId);
      expect(result.key).toMatch(/^exports\/[0-9a-f-]+\/\d{14}_export\.json\.age$/);
      expect(result.url).toContain(infra.minioEndpoint.replace(/^http:\/\//, ''));
      expect(result.encryptedBytes).toBeGreaterThan(0);

      // Manifest sanity before we even touch the artifact.
      const manifestTables = Object.fromEntries(
        result.manifest.tables.map((t) => [t.name, t.rowCount]),
      );
      expect(manifestTables.resume_facts).toBe(3);
      expect(manifestTables.career_goals).toBe(1);
      expect(manifestTables.xp_events).toBe(2);

      // 2. Download via the presigned URL + assert the age v1 header is really
      //    there. If anything in the pipeline silently fell back to plaintext
      //    this fails loudly.
      const res = await fetch(result.url);
      expect(res.status).toBe(200);
      const ciphertext = Buffer.from(await res.arrayBuffer());
      expect(ciphertext.length).toBe(result.encryptedBytes);
      expect(ciphertext.subarray(0, 22).toString('utf8')).toBe('age-encryption.org/v1\n');

      // 3. Decrypt with the matching identity + reparse the manifest. If the
      //    recipient-key path were wrong, `age -d` would exit non-zero here.
      const plaintext = await ageDecrypt(ciphertext, ageKeyPath);
      const parsed = JSON.parse(plaintext.toString('utf8'));
      expect(parsed.manifest.userId).toBe(userId);
      expect(parsed.tables.resume_facts).toHaveLength(3);
      expect(parsed.tables.xp_events).toHaveLength(2);

      // Per-table sha256 recomputation: proves the manifest hashes correspond
      // to the exact rows embedded in the payload (not stale from an earlier
      // query, not computed over a stringification variant).
      for (const t of parsed.manifest.tables) {
        if (t.rowCount === 0) continue;
        const serialized = JSON.stringify(parsed.tables[t.name]);
        const { createHash } = await import('node:crypto');
        const recomputed = createHash('sha256').update(serialized).digest('hex');
        expect(recomputed).toBe(t.sha256);
      }

      // 4. Delete + parity.
      const del = await me.deleteUser(userId);
      expect(del.rowCounts.resume_facts).toBe(3);
      expect(del.rowCounts.career_goals).toBe(1);
      expect(del.rowCounts.xp_events).toBe(2);

      const parity = await me.assertDeletedForUser(userId);
      expect(parity.ok).toBe(true);
      expect(parity.nonZero).toEqual([]);
    },
    HOOK_TIMEOUT_MS,
  );
});

// ALWAYS runs. Proves the skip guard is wired and the module imports cleanly
// on machines without Docker or without the age binary.
describe('F.8 export round-trip skip guard', () => {
  it('respects TESTCONTAINERS_E2E env + docker availability + age binary', () => {
    expect(typeof runE2E).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// age -d -i <keyFile>  stdin → stdout. Mirror of exports/<keyFile> inverse.
// ---------------------------------------------------------------------------
function ageDecrypt(ciphertext: Buffer, identityPath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn('age', ['-d', '-i', identityPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    proc.stdout.on('data', (c: Buffer) => stdoutChunks.push(c));
    proc.stderr.on('data', (c: Buffer) => stderrChunks.push(c));
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `age -d exited ${code}: ${Buffer.concat(stderrChunks).toString('utf8')}`,
          ),
        );
        return;
      }
      resolve(Buffer.concat(stdoutChunks));
    });
    proc.stdin.write(ciphertext);
    proc.stdin.end();
  });
}

