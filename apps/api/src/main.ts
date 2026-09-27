import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { runStartupChecks } from './startup-check';

async function bootstrap() {
  runStartupChecks();

  const app = await NestFactory.create(AppModule, { bodyParser: true, bufferLogs: true });
  app.useLogger(app.get(Logger));

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:'],
          'connect-src': ["'self'"],
          'frame-ancestors': ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.enableCors({
    origin: (process.env.TRUSTED_ORIGINS ?? '').split(',').filter(Boolean),
    credentials: true,
  });

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port, '0.0.0.0');

  app.get(Logger).log(`listening on :${port}  env=${process.env.NODE_ENV}`, 'Bootstrap');
}

bootstrap().catch((err) => {
  // Boot failure: no logger yet, use stderr directly.
  // eslint-disable-next-line no-console
  console.error('[careeros-api] failed to start:', err);
  process.exit(1);
});
