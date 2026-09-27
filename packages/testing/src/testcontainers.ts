// Testcontainers helper for integration tests.
//
// Usage:
//   const infra = await startInfra();
//   const prisma = new PrismaClient({ datasources: { db: { url: infra.postgresUrl } } });
//   ...
//   await infra.cleanup();
//
// Docker is required. Tests should guard with `isDockerAvailable()` and
// `describe.skip` on machines without a daemon; see example.integration.test.ts.
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from 'testcontainers';

export interface StartedInfra {
  postgresUrl: string;
  redisUrl: string;
  qdrantUrl: string;
  minioEndpoint: string;
  minioAccessKey: string;
  minioSecretKey: string;
  cleanup: () => Promise<void>;
}

export interface StartInfraOptions {
  /** Skip services you do not need. Default: all four spin up. */
  services?: Partial<Record<'postgres' | 'redis' | 'qdrant' | 'minio', boolean>>;
}

// ponytail: image digests intentionally NOT pinned here (A-M7 governs runtime
// compose files, not ephemeral test containers). Bump tags when a CVE lands.
const PG_IMAGE = 'postgres:16-alpine';
const REDIS_IMAGE = 'redis:7-alpine';
const QDRANT_IMAGE = 'qdrant/qdrant:v1.11.3';
const MINIO_IMAGE = 'minio/minio:RELEASE.2024-10-13T13-34-11Z';

export async function startInfra(opts: StartInfraOptions = {}): Promise<StartedInfra> {
  const want = {
    postgres: opts.services?.postgres ?? true,
    redis: opts.services?.redis ?? true,
    qdrant: opts.services?.qdrant ?? true,
    minio: opts.services?.minio ?? true,
  };

  const started: StartedTestContainer[] = [];
  const cleanup = async () => {
    // Stop in reverse start order; swallow errors so one bad stop does not
    // leak the rest.
    for (const c of started.reverse()) {
      try {
        await c.stop({ timeout: 10_000 });
      } catch {
        // ignore
      }
    }
  };

  try {
    let postgresUrl = '';
    let redisUrl = '';
    let qdrantUrl = '';
    let minioEndpoint = '';
    const minioAccessKey = 'testminio';
    const minioSecretKey = 'testminio-secret';

    if (want.postgres) {
      const pg = await new GenericContainer(PG_IMAGE)
        .withEnvironment({
          POSTGRES_USER: 'test',
          POSTGRES_PASSWORD: 'test',
          POSTGRES_DB: 'test',
        })
        .withExposedPorts(5432)
        .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
        .start();
      started.push(pg);
      postgresUrl = `postgres://test:test@${pg.getHost()}:${pg.getMappedPort(5432)}/test`;
    }

    if (want.redis) {
      const redis = await new GenericContainer(REDIS_IMAGE)
        .withExposedPorts(6379)
        .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
        .start();
      started.push(redis);
      redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
    }

    if (want.qdrant) {
      const qdrant = await new GenericContainer(QDRANT_IMAGE)
        .withExposedPorts(6333)
        .withWaitStrategy(Wait.forHttp('/readyz', 6333))
        .start();
      started.push(qdrant);
      qdrantUrl = `http://${qdrant.getHost()}:${qdrant.getMappedPort(6333)}`;
    }

    if (want.minio) {
      const minio = await new GenericContainer(MINIO_IMAGE)
        .withCommand(['server', '/data'])
        .withEnvironment({
          MINIO_ROOT_USER: minioAccessKey,
          MINIO_ROOT_PASSWORD: minioSecretKey,
        })
        .withExposedPorts(9000)
        .withWaitStrategy(Wait.forHttp('/minio/health/ready', 9000))
        .start();
      started.push(minio);
      minioEndpoint = `http://${minio.getHost()}:${minio.getMappedPort(9000)}`;
    }

    return {
      postgresUrl,
      redisUrl,
      qdrantUrl,
      minioEndpoint,
      minioAccessKey,
      minioSecretKey,
      cleanup,
    };
  } catch (err) {
    await cleanup();
    throw err;
  }
}

export { isDockerAvailable } from './docker-available';
