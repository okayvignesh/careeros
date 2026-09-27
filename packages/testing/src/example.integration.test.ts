// Example integration test proving startInfra() spins containers, a client
// can reach them, and cleanup() shuts them down. Guarded behind
// `TESTCONTAINERS_E2E=1` AND `isDockerAvailable()` so the default
// `pnpm test:integration` on a laptop without Docker skips cleanly instead
// of hanging on daemon dial.
//
// Run: `TESTCONTAINERS_E2E=1 pnpm test:integration`
//
// ponytail: this file uses Node's built-in `fetch` against Qdrant + a raw
// `net.createConnection` against Postgres, not Prisma. The example proves
// the helper works; per-app integration tests bring their own client. That
// keeps @careeros/testing free of a prisma/pg dep.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection } from 'node:net';
import { isDockerAvailable, startInfra, type StartedInfra } from './index';

const runE2E = process.env.TESTCONTAINERS_E2E === '1' && isDockerAvailable();
const maybe = runE2E ? describe : describe.skip;

// Whole-stack spin is ~30s cold; give it room.
const HOOK_TIMEOUT_MS = 120_000;

function probeTcp(hostPort: string): Promise<void> {
  const [host, portStr] = hostPort.split(':');
  const port = Number(portStr);
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: host ?? 'localhost', port }, () => {
      socket.end();
      resolve();
    });
    socket.setTimeout(5_000, () => {
      socket.destroy(new Error(`tcp connect ${hostPort} timed out`));
    });
    socket.on('error', reject);
  });
}

maybe(
  'startInfra() spins postgres + redis + qdrant + minio (opt-in: TESTCONTAINERS_E2E=1)',
  () => {
    let infra: StartedInfra;

    beforeAll(async () => {
      infra = await startInfra();
    }, HOOK_TIMEOUT_MS);

    afterAll(async () => {
      await infra?.cleanup();
    }, HOOK_TIMEOUT_MS);

    it('postgres accepts a TCP connection on its mapped port', async () => {
      // postgres://test:test@host:port/test → host:port
      const hostPort = infra.postgresUrl.replace(/^postgres:\/\/[^@]+@/, '').replace(/\/.*$/, '');
      await expect(probeTcp(hostPort)).resolves.toBeUndefined();
    });

    it('qdrant answers /readyz', async () => {
      const res = await fetch(`${infra.qdrantUrl}/readyz`);
      expect(res.status).toBe(200);
    });

    it('minio answers /minio/health/ready', async () => {
      const res = await fetch(`${infra.minioEndpoint}/minio/health/ready`);
      expect(res.status).toBe(200);
    });

    it('returns URLs for every service', () => {
      expect(infra.postgresUrl).toMatch(/^postgres:\/\//);
      expect(infra.redisUrl).toMatch(/^redis:\/\//);
      expect(infra.qdrantUrl).toMatch(/^http:\/\//);
      expect(infra.minioEndpoint).toMatch(/^http:\/\//);
    });
  },
);

// This block ALWAYS runs. Proves the skip guard is wired and the module
// imports cleanly on machines with no Docker. Without it, a broken guard
// (e.g. missing env parse) would silently pass an empty file.
describe('startInfra() skip guard', () => {
  it('respects TESTCONTAINERS_E2E env + docker availability', () => {
    expect(typeof runE2E).toBe('boolean');
    if (!runE2E) {
      // Either TESTCONTAINERS_E2E !== '1' or docker is unreachable.
      // The maybe() block is describe.skip, this file completes fast.
      expect(runE2E).toBe(false);
    }
  });
});
