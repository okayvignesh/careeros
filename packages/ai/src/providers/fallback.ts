import { type z } from 'zod';
import type {
  AIProvider,
  ChatMessage,
  ProviderCapabilities,
  ProviderProbeResult,
} from '../provider';
import {
  InjectionBlockedError,
  LLMProviderError,
  SensitivityBlockedError,
  StructuredOutputError,
} from '../errors';

export interface CircuitBreakerOptions {
  /** Consecutive availability failures before a provider is skipped. Default 5. */
  failureThreshold?: number;
  /** How long the breaker stays open before a half-open probe. Default 60s. */
  cooldownMs?: number;
}

interface BreakerEntry {
  failures: number;
  openUntil: number;
}

/**
 * Consecutive-failure circuit breaker keyed by provider id. After
 * `failureThreshold` failures the key is open for `cooldownMs`; once the
 * cooldown elapses the next attempt is a half-open probe whose failure starts
 * a fresh count (matching AGENTS.md: 5 fails → 60s open → half-open probe).
 */
export class CircuitBreaker {
  private readonly state = new Map<string, BreakerEntry>();

  constructor(
    private readonly failureThreshold = 5,
    private readonly cooldownMs = 60_000,
  ) {}

  isOpen(key: string, now = Date.now()): boolean {
    const entry = this.state.get(key);
    if (!entry || entry.openUntil === 0) return false;
    if (now >= entry.openUntil) {
      this.state.delete(key);
      return false;
    }
    return true;
  }

  recordSuccess(key: string): void {
    this.state.delete(key);
  }

  recordFailure(key: string, now = Date.now()): void {
    const entry = this.state.get(key) ?? { failures: 0, openUntil: 0 };
    entry.failures += 1;
    if (entry.failures >= this.failureThreshold) entry.openUntil = now + this.cooldownMs;
    this.state.set(key, entry);
  }

  status(
    key: string,
    now = Date.now(),
  ): { failures: number; open: boolean; retryAt: number | null } {
    const entry = this.state.get(key);
    if (!entry) return { failures: 0, open: false, retryAt: null };
    const open = entry.openUntil > now;
    return { failures: entry.failures, open, retryAt: open ? entry.openUntil : null };
  }

  reset(): void {
    this.state.clear();
  }
}

export interface FallbackInfo {
  /** Provider id that actually served the call. */
  activeProvider: string;
  /** Provider id that would normally serve it (candidates[0]). */
  primaryProvider: string;
  /** Last availability error from the provider we degraded away from. */
  reason: string;
}

export interface FallbackProviderOptions extends CircuitBreakerOptions {
  /** Namespace circuit keys per user, e.g. the userId. */
  keyPrefix?: string | undefined;
  /** Fired when a non-primary provider serves a call (feeds the degraded badge). */
  onFallback?: ((info: FallbackInfo) => void) | undefined;
  /** Share one breaker across provider instances (required for load-per-call). */
  breaker?: CircuitBreaker | undefined;
}

/**
 * Ordered primary → backup → local-Ollama wrapper. It only falls through on
 * *availability* failures (non-2xx / network); schema-validation, sensitivity,
 * and injection errors propagate untouched so policy is never bypassed and a
 * misbehaving model is not hidden behind a second provider.
 */
export class FallbackProvider implements AIProvider {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;
  private readonly candidates: readonly AIProvider[];
  private readonly breaker: CircuitBreaker;
  private readonly keyPrefix: string | undefined;
  private readonly onFallback: ((info: FallbackInfo) => void) | undefined;
  private active: string;
  private degradedNow = false;

  constructor(candidates: readonly AIProvider[], options: FallbackProviderOptions = {}) {
    if (candidates.length === 0) throw new Error('FallbackProvider requires at least one candidate');
    this.candidates = candidates;
    const primary = candidates[0]!;
    this.name = primary.name;
    this.capabilities = primary.capabilities;
    this.breaker =
      options.breaker ?? new CircuitBreaker(options.failureThreshold, options.cooldownMs);
    this.keyPrefix = options.keyPrefix;
    this.onFallback = options.onFallback;
    this.active = primary.name;
  }

  get degraded(): boolean {
    return this.degradedNow;
  }

  get activeProvider(): string {
    return this.active;
  }

  chat(input: {
    messages: ChatMessage[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<string> {
    return this.run((provider) => provider.chat(input));
  }

  chatStructured<S extends z.ZodTypeAny>(input: {
    messages: ChatMessage[];
    schema: S;
    temperature?: number;
    maxTokens?: number;
  }): Promise<z.output<S>> {
    return this.run((provider) => provider.chatStructured(input));
  }

  async probe(): Promise<ProviderProbeResult> {
    let last: ProviderProbeResult | null = null;
    for (const provider of this.candidates) {
      if (this.breaker.isOpen(this.keyFor(provider))) continue;
      const result = await provider.probe();
      if (result.reachable) {
        this.setActive(provider, '');
        return result;
      }
      last = result;
    }
    return last ?? { reachable: false, latencyMs: 0, error: 'no_candidate' };
  }

  private async run<T>(fn: (provider: AIProvider) => Promise<T>): Promise<T> {
    let lastError: unknown;
    let lastReason = '';
    for (const provider of this.candidates) {
      const key = this.keyFor(provider);
      if (this.breaker.isOpen(key)) continue;
      try {
        const out = await fn(provider);
        this.breaker.recordSuccess(key);
        this.setActive(provider, lastReason);
        return out;
      } catch (err) {
        if (!isAvailabilityFailure(err)) throw err;
        this.breaker.recordFailure(key);
        lastError = err;
        lastReason = (err as Error).message;
      }
    }
    if (lastError) throw lastError;
    throw new LLMProviderError('All providers are unavailable', 'circuit_open');
  }

  private keyFor(provider: AIProvider): string {
    return this.keyPrefix ? `${this.keyPrefix}:${provider.name}` : provider.name;
  }

  private setActive(provider: AIProvider, reason: string): void {
    this.active = provider.name;
    this.degradedNow = provider !== this.candidates[0];
    if (this.degradedNow) {
      this.onFallback?.({
        activeProvider: provider.name,
        primaryProvider: this.candidates[0]!.name,
        reason,
      });
    }
  }
}

/**
 * Only upstream availability problems trigger a fallback. A provider that
 * answered but produced invalid JSON is up; a sensitivity/injection block is
 * policy and must never be routed around.
 */
function isAvailabilityFailure(err: unknown): boolean {
  if (err instanceof StructuredOutputError) return false;
  if (err instanceof SensitivityBlockedError) return false;
  if (err instanceof InjectionBlockedError) return false;
  return true;
}
