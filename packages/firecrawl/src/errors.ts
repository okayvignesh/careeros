/**
 * Typed errors for the Firecrawl client. The API key is never embedded in a
 * message; `FirecrawlApiError` keeps the upstream status so `retry` can apply
 * the shared 429/5xx policy without parsing strings.
 */

/** Base class so callers can catch every Firecrawl failure with one `catch`. */
export class FirecrawlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FirecrawlError';
  }
}

/**
 * Missing / blank configuration — almost always `FIRECRAWL_API_KEY`. Thrown
 * lazily at client construction, never at import, so a missing key degrades to
 * "source unavailable" instead of crashing app boot.
 */
export class FirecrawlConfigError extends FirecrawlError {
  constructor(message: string) {
    super(message);
    this.name = 'FirecrawlConfigError';
  }
}

/**
 * Upstream returned non-2xx or an envelope with `success: false`. `status` is
 * set so `@careeros/shared` retry treats 429/5xx as retryable and 4xx as fatal.
 */
export class FirecrawlApiError extends FirecrawlError {
  readonly status: number;
  constructor(status: number, message: string) {
    super(`firecrawl api error (${status}): ${message}`);
    this.name = 'FirecrawlApiError';
    this.status = status;
  }
}

/** Response body did not match the expected Firecrawl v1 shape. Not retryable. */
export class FirecrawlMalformedResponseError extends FirecrawlError {
  constructor(path: string, detail: string) {
    super(`firecrawl malformed response for ${path}: ${detail}`);
    this.name = 'FirecrawlMalformedResponseError';
  }
}

/** The request exceeded its configured timeout (or was aborted). Retryable. */
export class FirecrawlTimeoutError extends FirecrawlError {
  constructor(path: string, timeoutMs: number) {
    super(`firecrawl request timed out after ${timeoutMs}ms: ${path}`);
    this.name = 'FirecrawlTimeoutError';
  }
}
