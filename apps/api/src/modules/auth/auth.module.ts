import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import Redis from 'ioredis';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { SecurityMiddleware } from './security.middleware';

@Global()
@Module({
  imports: [
    // A-C1: global 100 req/min per IP. Redis-backed so multi-replica shares
    // state. Per-endpoint tighter limits live on `@Throttle` decorators
    // (see auth/throttle.decorator.ts).
    ThrottlerModule.forRootAsync({
      useFactory: () => ({
        throttlers: [{ ttl: 60_000, limit: 100 }],
        storage: new ThrottlerStorageRedisService(
          new Redis(process.env.REDIS_URL ?? 'redis://redis:6379', {
            maxRetriesPerRequest: 3,
            enableReadyCheck: false,
          }),
        ),
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionService,
    SecurityMiddleware,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
  exports: [AuthService, SessionService],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // A-H1 + A-H3: runs before every controller.
    consumer.apply(SecurityMiddleware).forRoutes('*');
  }
}
