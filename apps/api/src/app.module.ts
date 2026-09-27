import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { LoggerModule, type Params } from 'nestjs-pino';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './common/storage.module';
import { QueueModule } from './common/queue.module';
import { SensitivityGateModule } from './common/sensitivity-gate.module';
import { MetricsModule } from './common/metrics/metrics.module';
import { HttpMetricsMiddleware } from './common/metrics/http-metrics.middleware';
import {
  RequestIdMiddleware,
  generateRequestId,
  REDACTION_PATHS,
} from './common/logging/request-id.middleware';
import { HealthModule } from './modules/health/health.module';
import { SetupModule } from './modules/setup/setup.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProvidersModule } from './modules/providers/providers.module';
import { EmbeddingsModule } from './modules/embeddings/embeddings.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { GitlabModule } from './modules/integrations/gitlab/gitlab.module';
import { ResumeModule } from './modules/resume/resume.module';
import { GoalsModule } from './modules/goals/goals.module';
import { RecoveryModule } from './modules/recovery/recovery.module';
import { UsageModule } from './modules/usage/usage.module';
import { StatsModule } from './modules/stats/stats.module';
import { SkillsModule } from './modules/skills/skills.module';
import { EvidenceModule } from './modules/evidence/evidence.module';
import { FactsModule } from './modules/facts/facts.module';
import { SearchModule } from './modules/search/search.module';
import { WorkersModule } from './modules/workers/workers.module';
import { AssessmentsModule } from './modules/assessments/assessments.module';
import { CorpusModule } from './modules/corpus/corpus.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { JobPreferencesModule } from './modules/job-prefs/job-prefs.module';
import { MarketBriefModule } from './modules/market-brief/market-brief.module';
import { ResumeVariantsModule } from './modules/resume-variants/resume-variants.module';
import { CoverLettersModule } from './modules/cover-letters/cover-letters.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { MatcherModule } from './modules/matcher/matcher.module';
import { DossierModule } from './modules/dossier/dossier.module';
import { QuestsModule } from './modules/quests/quests.module';
import { AgentModule } from './modules/agent/agent.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { GmailModule } from './modules/gmail/gmail.module';

const loggerParams: Params = {
  pinoHttp: {
    level: process.env.LOG_LEVEL ?? 'info',
    genReqId: generateRequestId,
    redact: {
      paths: REDACTION_PATHS,
      censor: '[REDACTED]',
    },
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    ...(process.env.NODE_ENV === 'production'
      ? {}
      : {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss.l', singleLine: true },
          },
        }),
  },
};

@Module({
  imports: [
    LoggerModule.forRoot(loggerParams),
    PrismaModule,
    StorageModule,
    QueueModule,
    SensitivityGateModule,
    MetricsModule,
    AuthModule,
    ProvidersModule,
    EmbeddingsModule,
    IntegrationsModule,
    GitlabModule,
    ResumeModule,
    GoalsModule,
    RecoveryModule,
    UsageModule,
    StatsModule,
    SkillsModule,
    EvidenceModule,
    FactsModule,
    SearchModule,
    WorkersModule,
    AssessmentsModule,
    CorpusModule,
    JobsModule,
    JobPreferencesModule,
    MarketBriefModule,
    ResumeVariantsModule,
    CoverLettersModule,
    ApplicationsModule,
    MatcherModule,
    DossierModule,
    QuestsModule,
    AgentModule,
    ApprovalsModule,
    HealthModule,
    SetupModule,
  ],
})
export class AppModule implements NestModule {
  // C-P4.8: request-id first so pino, the HTTP metrics middleware, and any
  // downstream handler all see the same `req.reqId`. Metrics second.
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware, HttpMetricsMiddleware).forRoutes('*');
  }
}
