import { Injectable, Module, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from './metrics/metrics.service';
import { installInjectionAuditHooks } from './injection-log';

/**
 * Installs the process-wide injection audit hooks once at boot. Kept as its own
 * module (rather than a side effect in `main.ts`) so the wiring is testable and
 * the teardown runs on shutdown. PrismaModule + MetricsModule are global.
 */
@Injectable()
export class InjectionAuditInstaller implements OnModuleInit, OnModuleDestroy {
  private teardown: (() => void) | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(InjectionAuditInstaller.name) private readonly logger: PinoLogger,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  onModuleInit(): void {
    this.teardown = installInjectionAuditHooks(
      this.prisma,
      this.logger,
      this.metrics,
    );
  }

  onModuleDestroy(): void {
    this.teardown?.();
    this.teardown = null;
  }
}

@Module({
  providers: [InjectionAuditInstaller],
})
export class InjectionAuditModule {}
