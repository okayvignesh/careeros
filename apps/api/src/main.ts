import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';
import { runStartupChecks } from './startup-check';

async function bootstrap() {
  runStartupChecks();

  const app = await NestFactory.create(AppModule, { bodyParser: true, bufferLogs: true });
  app.useLogger(app.get(Logger));

  // A-H2: per-request nonce for CSP so we can drop `'unsafe-inline'` entirely
  // from script-src + style-src. Next.js SSR that needs an inline chunk can
  // stamp `nonce={res.locals.cspNonce}` on the tag; anything without a nonce
  // is refused by the browser. Nonce must be fresh per response.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.locals.cspNonce = randomBytes(16).toString('base64');
    next();
  });

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          // Nonce-based. Next.js SSR must stamp `nonce=` on any inline tag.
          // If a build ever ships an inline chunk that can't be stamped, use
          // `'strict-dynamic'` + integrity hashes and document the exception
          // right here so a reviewer sees the reason.
          'script-src': ["'self'", (_req, res) => `'nonce-${(res as Response).locals.cspNonce}'`],
          'style-src': ["'self'", (_req, res) => `'nonce-${(res as Response).locals.cspNonce}'`],
          'img-src': ["'self'", 'data:'],
          'connect-src': ["'self'"],
          'frame-ancestors': ["'none'"],
          'base-uri': ["'self'"],
          'form-action': ["'self'"],
          'object-src': ["'none'"],
        },
      },
      // A-H2: explicit modern header set. Every value here is from
      // plan/security.md item 2.
      strictTransportSecurity: {
        maxAge: 63072000, // 2 years
        includeSubDomains: true,
        preload: true,
      },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      // CORP + COEP left at helmet defaults; enabling `require-corp` breaks
      // dev-time Next.js image loading. Revisit when the deploy manifest
      // includes CORS headers on every static asset.
      crossOriginEmbedderPolicy: false,
      // helmet doesn't have a first-class Permissions-Policy setter; set it
      // manually below.
    }),
  );

  app.use((_req: Request, res: Response, next: NextFunction) => {
    // A-H2: deny camera/mic/geolocation/payment/usb/etc. — nothing here needs any.
    res.setHeader(
      'Permissions-Policy',
      [
        'accelerometer=()',
        'autoplay=()',
        'camera=()',
        'display-capture=()',
        'encrypted-media=()',
        'fullscreen=()',
        'geolocation=()',
        'gyroscope=()',
        'magnetometer=()',
        'microphone=()',
        'midi=()',
        'payment=()',
        'picture-in-picture=()',
        'publickey-credentials-get=(self)',
        'screen-wake-lock=()',
        'sync-xhr=()',
        'usb=()',
        'xr-spatial-tracking=()',
      ].join(', '),
    );
    next();
  });

  app.enableCors({
    origin: (process.env.TRUSTED_ORIGINS ?? '').split(',').filter(Boolean),
    credentials: true,
  });

  // A-C1: Express `trust proxy` so `req.ip` reflects the client through
  // the reverse proxy, not the proxy itself. Throttler + lockout both key
  // on IP so getting this right is load-bearing.
  const httpAdapter = app.getHttpAdapter();
  const instance: unknown = httpAdapter.getInstance?.();
  if (instance && typeof (instance as { set?: (k: string, v: unknown) => void }).set === 'function') {
    (instance as { set: (k: string, v: unknown) => void }).set('trust proxy', 1);
  }

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
