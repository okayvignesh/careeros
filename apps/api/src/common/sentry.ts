// Error tracking bootstrap. Self-hosted GlitchTip speaks the Sentry protocol,
// so `@sentry/node` works against it unchanged. The whole module is inert when
// no DSN is configured: `initSentry()` returns false and the process boots as
// if it did not exist. See docs/observability.md.
import * as Sentry from '@sentry/node';
import { redact } from '@careeros/shared';

/** `SENTRY_DSN` is canonical; `GLITCHTIP_DSN` is accepted as the self-hosted alias. */
export function resolveSentryDsn(): string | undefined {
  return firstNonEmpty([process.env.SENTRY_DSN, process.env.GLITCHTIP_DSN]);
}

/**
 * Release tag = git SHA. CI bakes `GIT_SHA` at image build time (see
 * infra/docker/Dockerfile.api); `SENTRY_RELEASE` overrides and the usual CI
 * SHA vars are accepted as fallbacks for host/dev runs.
 */
export function resolveSentryRelease(): string | undefined {
  return firstNonEmpty([
    process.env.SENTRY_RELEASE,
    process.env.GIT_SHA,
    process.env.GITHUB_SHA,
    process.env.SOURCE_VERSION,
  ], 'unknown');
}

/** Returns the first value that is present and non-blank. */
function firstNonEmpty(values: Array<string | undefined>, ignore?: string): string | undefined {
  for (const value of values) {
    const trimmed = (value ?? '').trim();
    if (trimmed.length > 0 && trimmed !== ignore) return trimmed;
  }
  return undefined;
}

let initialized = false;

/** Returns true when the SDK is live, false when the DSN is unset (no-op). */
export function initSentry(): boolean {
  if (initialized) return true;
  const dsn = resolveSentryDsn();
  if (!dsn) return false;

  Sentry.init({
    dsn,
    release: resolveSentryRelease(),
    environment: process.env.NODE_ENV ?? 'development',
    // Single-user self-hosted tool: collect no user identity, cookies, headers,
    // bodies, query params, or model I/O. `redact` is the same pass that guards
    // pino logs and is the second layer here.
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
    // Spec: 100% errors, 10% transactions (plan/observability.md).
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

/**
 * PII scrub applied to every event/transaction before transport: drop
 * identity + request context, then run the shared redaction pass.
 */
export function scrubEvent<E>(event: E): E {
  return redact(stripPii(event));
}

export function sentryEnabled(): boolean {
  return initialized;
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!initialized) return;
  Sentry.captureException(error, context ? { extra: redact(context) } : undefined);
}

export async function flushSentry(timeoutMs = 2_000): Promise<void> {
  if (!initialized) return;
  await Sentry.flush(timeoutMs);
}

/** Wires Sentry's Express error handler into a Nest app's HTTP adapter. */
export function setupSentryExpressErrorHandler(app: unknown): void {
  if (!initialized || !app) return;
  Sentry.setupExpressErrorHandler(
    app as Parameters<typeof Sentry.setupExpressErrorHandler>[0],
  );
}

/** Drops request/user identity before redaction; nothing PII leaves the box. */
function stripPii<E>(event: E): E {
  const record = event as unknown as Record<string, unknown>;
  delete record.user;
  delete record.request;
  return event;
}
