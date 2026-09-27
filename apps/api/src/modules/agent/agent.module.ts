import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { AgentJwtGuard } from './agent.jwt-strategy';
import { AgentGateway } from './agent.gateway';

/**
 * D.2 (Wave D / P3.5): registers the desktop-agent module. `JwtModule` is
 * wired inside this module so the secret is owned locally + never bleeds
 * into other modules' JwtService. Falls back to `SESSION_SECRET` when
 * `AGENT_JWT_SECRET` is unset so dev-host works without extra env.
 *
 * Ponytail: no separate `AgentJwtStrategy` (passport-jwt) — the `AgentJwtGuard`
 * does the header read and delegates all verification to `AgentService`.
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
  controllers: [AgentController],
  providers: [AgentService, AgentJwtGuard, AgentGateway],
  exports: [AgentService, AgentJwtGuard, AgentGateway, JwtModule],
})
export class AgentModule {}
