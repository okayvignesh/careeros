// LLM error types the API layer maps to sanitised HTTP responses. Every class
// keeps upstream / raw-error material on a non-enumerable field so it stays in
// server-side logs but never gets JSON-serialised into a client response.
//
// A-L1 (upstream error leakage): provider-level `throw new Error(json.error?.message)`
// used to surface DeepSeek / OpenAI internal messages verbatim to the client
// (stack traces, tenant IDs, model-name hints). Callers now see a fixed string;
// pino reads `.upstream` for the diagnostics.

/** Thrown when the upstream LLM provider returns non-2xx or a network error. */
export class LLMProviderError extends Error {
  readonly code = 'llm.provider_error';

  constructor(message: string, upstream: string) {
    super(message);
    this.name = 'LLMProviderError';
    // Non-enumerable so JSON.stringify(err) does not accidentally expose it.
    Object.defineProperty(this, 'upstream', {
      value: upstream,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }

  // Declared here so TypeScript sees the property; runtime install is in the ctor.
  readonly upstream!: string;
}

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

/**
 * Thrown by the SensitivityGate (packages/ai/src/sensitivity-gate.ts) when the
 * classified content-level exceeds the trust ceiling of the dispatch context
 * (e.g. `system-secret` content routed to `llm-external`). Fields are enumerable
 * so audit consumers can log them; the class name + `.code` are stable so API
 * layers can map to a sanitised 4xx. Wired into wrapUntrusted so the check runs
 * before injection scan (bail earlier = less LLM spend on doomed calls).
 */
export class SensitivityBlockedError extends Error {
  readonly code = 'security.audit.sensitivity_blocked';
  readonly level: string;
  readonly context: string;
  readonly reason: string;

  constructor(level: string, context: string, reason: string) {
    super(`Sensitivity gate blocked: level='${level}' context='${context}' (${reason})`);
    this.name = 'SensitivityBlockedError';
    this.level = level;
    this.context = context;
    this.reason = reason;
  }
}
