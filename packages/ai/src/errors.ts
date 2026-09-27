// LLM error types the API layer maps to sanitised HTTP responses. Every class
// keeps upstream / raw-error material on a non-enumerable field so it stays in
// server-side logs but never gets JSON-serialised into a client response.

/**
 * Thrown when chatStructured cannot obtain a schema-valid JSON response after
 * the single Zod-error retry. Carries the last ZodError message on `.reason`.
 */
export class StructuredOutputError extends Error {
  readonly code = 'llm.structured_output_invalid';

  constructor(reason: string) {
    super('LLM structured output failed schema validation');
    this.name = 'StructuredOutputError';
    Object.defineProperty(this, 'reason', {
      value: reason,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }

  readonly reason!: string;
}

/**
 * Thrown by wrapUntrusted when scanForInjection returns severity='blocked'.
 * Carries the hit list on `.hits` (non-enumerable) so operators can review
 * the offending patterns without them leaking into API responses.
 */
export class InjectionBlockedError extends Error {
  readonly code = 'security.audit.injection_blocked';

  constructor(kind: string, hits: string[]) {
    super(`Untrusted content blocked (${kind})`);
    this.name = 'InjectionBlockedError';
    Object.defineProperty(this, 'hits', {
      value: hits,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }

  readonly hits!: string[];
}
