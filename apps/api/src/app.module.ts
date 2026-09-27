import { Module } from '@nestjs/common';
import { LoggerModule, type Params } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './common/storage.module';
import { QueueModule } from './common/queue.module';
import { SensitivityGateModule } from './common/sensitivity-gate.module';
import { HealthModule } from './modules/health/health.module';
import { SetupModule } from './modules/setup/setup.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProvidersModule } from './modules/providers/providers.module';
import { EmbeddingsModule } from './modules/embeddings/embeddings.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
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

const loggerParams: Params = {
  pinoHttp: {
    level: process.env.LOG_LEVEL ?? 'info',
    genReqId: (req, res) => {
      const incoming = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
      res.setHeader('x-request-id', incoming);
      return incoming;
    },
    redact: {
      paths: [
        // Request/response headers that carry credentials.
        'req.headers.cookie',
        'req.headers.authorization',
        'req.headers["x-api-key"]',
        'res.headers["set-cookie"]',
        // Request bodies for known secret-carrying endpoints.
        'req.body.password',
        'req.body.apiKey',
        'req.body.apikey',
        'req.body.token',
        'req.body.access_token',
        'req.body.refresh_token',
        'req.body.client_secret',
        'req.body.secretKey',
        'req.body.ciphertext',
        // One-level wildcards for internal objects passed to loggers.
        '*.password',
        '*.apiKey',
        '*.apikey',
        '*.token',
        '*.access_token',
        '*.refresh_token',
        '*.client_secret',
        '*.secretKey',
        '*.ciphertext',
      ],
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
    AuthModule,
    ProvidersModule,
    EmbeddingsModule,
    IntegrationsModule,
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
    HealthModule,
    SetupModule,
  ],
})
export class AppModule {}
