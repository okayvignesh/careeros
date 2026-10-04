import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import Redis from 'ioredis';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { SecurityMiddleware } from './security.middleware';
import { PasskeyService } from './passkey.service';
import { PasskeyController } from './passkey.controller';
import { RecoveryCodesService } from './recovery.service';
import { RecoveryCodesController } from './recovery.controller';
import { SessionController } from './session.controller';

@Global()
@Module({
  imports: [
    // A-C1: global 100 req/min per IP. Redis-backed so multi-replica shares
    // state. Per-endpoint tighter limits live on `@Throttle` decorators
    // (see auth/throttle.decorator.ts).
    ThrottlerModule.forRootAsync({
      useFactory: () => ({
        // Defaults match plan/security.md item 4 (100 req/min/IP). Overridable
        // so the e2e CI job (which visits many pages, each triggering the web
        // tier's server-side /setup/state call) can raise the cap without
        // weakening production defaults.
        throttlers: [
          {
            ttl: Number(process.env.THROTTLE_TTL_MS ?? 60_000),
            limit: Number(process.env.THROTTLE_LIMIT ?? 100),
          },
        ],
        storage: new ThrottlerStorageRedisService(
          new Redis(process.env.REDIS_URL ?? 'redis://redis:6379', {
            maxRetriesPerRequest: 3,
            enableReadyCheck: false,
          }),
        ),
      }),
    }),
  ],
  controllers: [AuthController, PasskeyController, RecoveryCodesController, SessionController],
  providers: [
    AuthService,
    SessionService,
    SecurityMiddleware,
    // C-P0.7: passkey + recovery-code services.
    PasskeyService,
    RecoveryCodesService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
  exports: [AuthService, SessionService, PasskeyService, RecoveryCodesService],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // A-H1 + A-H3: runs before every controller.
    consumer.apply(SecurityMiddleware).forRoutes('*');
  }
}
