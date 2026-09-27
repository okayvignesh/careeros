import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * 60s Redis cache for Usage & Costs aggregation queries. Invalidated by
 * bumping a per-user version counter whenever a new `llm_calls` row is written
 * (see `bumpVersion` — called from `llm-audit`). Old cache keys are left to
 * expire naturally; no explicit delete needed.
 *
 * ponytail: cache-aside with TTL 60s. Fine at personal-use scale; if the dashboard
 * ever fans out to many concurrent readers, add a request-coalescer.
 */
@Injectable()
export class UsageCache implements OnModuleDestroy {
  private readonly logger = new Logger(UsageCache.name);
  private readonly redis: Redis;
  private readonly ttl = 60;

  constructor() {
    this.redis = new Redis(process.env.REDIS_URL ?? 'redis://redis:6379', {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    this.redis.on('error', (err) => this.logger.warn(`redis error: ${err.message}`));
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => {});
  }

  async remember<T>(userId: string, tag: string, load: () => Promise<T>): Promise<T> {
    const version = await this.version(userId);
    const key = `usage:c:${userId}:v${version}:${tag}`;
    try {
      const hit = await this.redis.get(key);
      if (hit) return JSON.parse(hit) as T;
    } catch (err) {
      this.logger.warn(`cache read miss (${(err as Error).message}); computing`);
    }
    const value = await load();
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', this.ttl);
    } catch {
      // Cache-set failure is non-fatal; return the value anyway.
    }
    return value;
  }

  async bumpVersion(userId: string | null): Promise<void> {
    if (!userId) return;
    try {
      await this.redis.incr(`usage:v:${userId}`);
    } catch {
      // If Redis is down, next read misses the cache and recomputes. No harm.
    }
  }

  private async version(userId: string): Promise<number> {
    try {
      const v = await this.redis.get(`usage:v:${userId}`);
      return v ? Number(v) : 0;
    } catch {
      return 0;
    }
  }
}
