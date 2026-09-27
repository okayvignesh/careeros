/**
 * Typed errors for adapter failures. Kept small; every error carries an
 * adapter id so the sync UI can attribute the failure without parsing strings.
 */

export class AdapterError extends Error {
  constructor(readonly adapter: string, message: string) {
    super(`[${adapter}] ${message}`);
    this.name = 'AdapterError';
  }
}

/**
 * Upstream returned a body that failed schema validation. The adapter should
 * throw this instead of silently dropping malformed rows, so `sync()` records
 * the failure (via `logger.warn`) rather than reporting a false-clean run.
 */
export class MalformedResponseError extends AdapterError {
  constructor(adapter: string, readonly detail: string) {
    super(adapter, `malformed response: ${detail}`);
    this.name = 'MalformedResponseError';
  }
}

/**
 * Adapter needs env-based credentials but they are missing / blank at fetch
 * time. Thrown at fetch, NOT at import — a missing key should not crash the
 * whole API boot, only the sync run that tries to use it.
 */
export class MissingCredentialError extends AdapterError {
  constructor(adapter: string, readonly envKeys: string[]) {
    super(adapter, `missing credentials: ${envKeys.join(', ')}`);
    this.name = 'MissingCredentialError';
  }
}
