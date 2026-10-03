import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';
import { MobileAuthMiddleware } from './mobile.middleware';
import { MobileController } from './mobile.controller';
import { MobileService } from './mobile.service';

/**
 * B1 (phase 7 mobile): token auth for the Expo app. `JwtModule` is registered
 * locally (same secret resolution as `AgentModule`) so the mobile signer is
 * isolated to this module. `MobileAuthMiddleware` is applied globally so the
 * existing cookie-guarded read controllers transparently accept the bearer.
 */
@Module({
  imports: [
    AuthModule,
    JwtModule.registerAsync({
      useFactory: () => {
        const secret = process.env.AGENT_JWT_SECRET ?? process.env.SESSION_SECRET;
        if (!secret || secret.length < 32) {
          throw new Error(
            'AGENT_JWT_SECRET (or SESSION_SECRET fallback) required and must be >= 32 chars.',
          );
        }
        return { secret };
      },
    }),
  ],
  controllers: [MobileController],
  providers: [MobileService, MobileAuthMiddleware],
})
export class MobileModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(MobileAuthMiddleware).forRoutes('*');
  }
}
