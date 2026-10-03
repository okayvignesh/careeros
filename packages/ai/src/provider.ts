import type { z } from 'zod';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Static per-adapter description of what a provider can do. Reported to the
 * setup wizard + the health page; used by higher layers to pick the right
 * provider for a call (embed vs. chat vs. tools). Values are real (contextWindow
 * is model-specific), not aspirational.
 */
export interface ProviderCapabilities {
  /** JSON-mode / response_format supported end to end. */
  structuredOutput: boolean;
  /** SSE streaming chat completions supported. */
  streaming: boolean;
  /** OpenAI-style function/tool calls supported. */
  toolUse: boolean;
  /** Max input tokens for the selected chat model. */
  contextWindow: number;
  /** Native embedding endpoint supported. */
  embeddings: boolean;
}

/**
 * Lightweight reachability probe. Distinct from the deeper capability-suite
 * `ProbeResult` in `./probe.ts` (which runs 4 real chat/tool/stream calls);
 * this one hits a single low-cost endpoint (GET /models or equivalent) so the
 * wizard can tell "provider is reachable" from "creds work end to end".
 */
export interface ProviderProbeResult {
  reachable: boolean;
  latencyMs: number;
  error?: string;
}

/**
 * Provider-agnostic contract. Every adapter (DeepSeek today; OpenAI, Ollama,
 * Anthropic later) implements this. Kept minimal — no method the concrete
 * doesn't need. `chatStructured` accepts `maxTokens` per Wave A A-H5.
 */
export interface AIProvider {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;
  /** Optional default; per-call `maxTokens` on chat / chatStructured overrides. */
  readonly maxTokens?: number;

  /**
   * Set by `FallbackProvider` once a non-primary candidate has served a call.
   * Adapters leave this undefined; the API surfaces it as a "degraded" badge.
   */
  readonly degraded?: boolean;
  /** Set by `FallbackProvider`: provider id that served the latest call. */
  readonly activeProvider?: string;

  chat(input: {
    messages: ChatMessage[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<string>;

  chatStructured<S extends z.ZodTypeAny>(input: {
    messages: ChatMessage[];
    schema: S;
    temperature?: number;
    maxTokens?: number;
  }): Promise<z.output<S>>;

  probe(): Promise<ProviderProbeResult>;
}
