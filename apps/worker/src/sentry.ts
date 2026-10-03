// Worker-side error tracking bootstrap. Mirrors apps/api/src/common/sentry.ts
// but is intentionally standalone: the worker is a separate workspace package
// and must not import from apps/api. Both call `packages/shared` redaction.
// Inert when no DSN is set. See docs/observability.md.
import * as Sentry from '@sentry/node';
import { redact } from '@careeros/shared';

function resolveDsn(): string | undefined {
  return firstNonEmpty([process.env.SENTRY_DSN, process.env.GLITCHTIP_DSN]);
}

function resolveRelease(): string | undefined {
  return firstNonEmpty(
    [
      process.env.SENTRY_RELEASE,
      process.env.GIT_SHA,
      process.env.GITHUB_SHA,
      process.env.SOURCE_VERSION,
    ],
    'unknown',
  );
}

function firstNonEmpty(values: Array<string | undefined>, ignore?: string): string | undefined {
  for (const value of values) {
    const trimmed = (value ?? '').trim();
    if (trimmed.length > 0 && trimmed !== ignore) return trimmed;
  }
  return undefined;
}

let initialized = false;

export function initSentry(): boolean {
  if (initialized) return true;
  const dsn = resolveDsn();
  if (!dsn) return false;

  Sentry.init({
    dsn,
    release: resolveRelease(),
    environment: process.env.NODE_ENV ?? 'development',
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      genAI: { inputs: false, outputs: false },
    },
    maxBreadcrumbs: 0,
    beforeBreadcrumb: () => null,
    tracesSampleRate: 0.1,
    beforeSend(event) {
      return scrubEvent(event);
    },
    beforeSendTransaction(event) {
      return scrubEvent(event);
    },
  });
  initialized = true;
  return true;
}

/** Mirrors apps/api/src/common/sentry.ts: drop identity, then run redaction. */
export function scrubEvent<E>(event: E): E {
  return redact(stripPii(event));
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!initialized) return;
  Sentry.captureException(error, context ? { extra: redact(context) } : undefined);
}

export async function flushSentry(timeoutMs = 2_000): Promise<void> {
  if (!initialized) return;
  await Sentry.flush(timeoutMs);
}

function stripPii<E>(event: E): E {
  const record = event as unknown as Record<string, unknown>;
  delete record.user;
  delete record.request;
  return event;
}
