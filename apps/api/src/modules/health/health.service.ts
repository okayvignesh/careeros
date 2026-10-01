import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { QdrantStore } from '@careeros/embeddings';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage.service';

export interface Check {
  ok: boolean;
  latencyMs: number;
  error?: string;
  detail?: string;
}

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'down';
  version: string;
  uptimeS: number;
  checks: Record<string, Check>;
}

let cached: { at: number; body: HealthResponse } | null = null;
const CACHE_MS = 5_000;

@Injectable()
export class HealthService {
  private redis = new Redis(process.env.REDIS_URL!, { lazyConnect: true, maxRetriesPerRequest: 1 });
  private qdrant = new QdrantStore(process.env.QDRANT_URL ?? 'http://qdrant:6333');
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async check(): Promise<HealthResponse> {
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.body;

    const [postgres, redis, qdrant, minio, ai] = await Promise.all([
      this.checkPostgres(),
      this.checkRedis(),
      this.checkQdrant(),
      this.checkMinio(),
      this.checkAi(),
    ]);
    const checks = { postgres, redis, qdrant, minio, ai };
    const allOk = Object.values(checks).every((c) => c.ok);

    const body: HealthResponse = {
      status: allOk ? 'ok' : 'degraded',
      version: process.env.APP_VERSION ?? '0.0.1',
      uptimeS: Math.floor((Date.now() - this.startedAt) / 1000),
      checks,
    };
    cached = { at: Date.now(), body };
    return body;
  }

  private async checkPostgres(): Promise<Check> {
    const t = Date.now();
    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        this.timeout(500, 'postgres timeout'),
      ]);
      return { ok: true, latencyMs: Date.now() - t };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - t, error: (e as Error).message };
    }
  }

  private async checkRedis(): Promise<Check> {
    const t = Date.now();
    try {
      if (this.redis.status !== 'ready') await this.redis.connect().catch(() => {});
      await Promise.race([this.redis.ping(), this.timeout(500, 'redis timeout')]);
      return { ok: true, latencyMs: Date.now() - t };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - t, error: (e as Error).message };
    }
  }

  private async checkQdrant(): Promise<Check> {
    const t = Date.now();
    try {
      const ok = await Promise.race([this.qdrant.ping(), this.timeout(1500, 'qdrant timeout')]);
      return ok
        ? { ok: true, latencyMs: Date.now() - t }
        : { ok: false, latencyMs: Date.now() - t, error: 'ping failed' };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - t, error: (e as Error).message };
    }
  }

  private async checkMinio(): Promise<Check> {
    const t = Date.now();
    try {
      const ok = await Promise.race([
        this.storage.ping(),
        this.timeout<boolean>(1500, 'minio timeout'),
      ]);
      return ok
        ? { ok: true, latencyMs: Date.now() - t }
        : { ok: false, latencyMs: Date.now() - t, error: 'ping failed' };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - t, error: (e as Error).message };
    }
  }

  private async checkAi(): Promise<Check> {
    const t = Date.now();
    try {
      const cfg = await this.prisma.providerConfig.findFirst({ where: { isDefault: true } });
      if (!cfg) {
        return { ok: false, latencyMs: Date.now() - t, error: 'no provider configured' };
      }
      return {
        ok: true,
        latencyMs: Date.now() - t,
        detail: `${cfg.provider}/${cfg.chatModel}`,
      };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - t, error: (e as Error).message };
    }
  }

  private timeout<T>(ms: number, msg: string): Promise<T> {
    return new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms));
  }
}
