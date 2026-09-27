import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import type { RequestHandler, Response } from 'express';
import { AppModule } from './app.module';
import { LockoutExceptionFilter } from './common/filters/lockout.filter';
import { runStartupChecks } from './startup-check';

// A-H2: exported so main.test.ts can assert against the EXACT middleware chain
// the process boots with, not an inline copy that drifts silently.
export const PERMISSIONS_POLICY = [
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
].join(', ');

export function buildSecurityMiddleware(): RequestHandler[] {
  const nonce: RequestHandler = (_req, res, next) => {
    res.locals.cspNonce = randomBytes(16).toString('base64');
    next();
  };
  const helmetMw = helmet({
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
    // via the trailing middleware below.
  });
  const permissions: RequestHandler = (_req, res, next) => {
    // A-H2: deny camera/mic/geolocation/payment/usb/etc.; nothing here needs any.
    res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
    next();
  };
  return [nonce, helmetMw as unknown as RequestHandler, permissions];
}

async function bootstrap() {
  runStartupChecks();

  // E.2: `rawBody: true` keeps `req.rawBody` populated so the Slack webhook
  // controller can HMAC-verify the exact bytes Slack signed. Nest still parses
  // JSON / urlencoded normally for every other route.
  const app = await NestFactory.create(AppModule, { bodyParser: true, rawBody: true, bufferLogs: true });
  app.useLogger(app.get(Logger));

  for (const mw of buildSecurityMiddleware()) app.use(mw);

  // A-C1: Retry-After header on LockoutError (429) responses.
  app.useGlobalFilters(new LockoutExceptionFilter());

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

// Only auto-boot when executed as the entry (skip when imported by tests).
if (require.main === module) {
  bootstrap().catch((err) => {
    // Boot failure: no logger yet, use stderr directly.
    // eslint-disable-next-line no-console
    console.error('[careeros-api] failed to start:', err);
    process.exit(1);
  });
}
