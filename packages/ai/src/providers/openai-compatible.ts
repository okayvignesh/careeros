import { type z } from 'zod';
import { assertPublicUrl, assertPublicUrlShape } from '@careeros/shared/net';
import type { AssertPublicUrlOptions } from '@careeros/shared/net';
import type {
  AIProvider,
  CallValidation,
  ChatMessage,
  LlmCallMeta,
  ProviderCapabilities,
  ProviderProbeResult,
} from '../provider';
import { LLMProviderError, TokenCapExceededError } from '../errors';
import { estimateMessagesTokens } from '../tokenize';
import { providerFetch } from './fetch';
import { zodToJsonSchemaObject } from './json-schema';
import {
  isSchemaParseFailure,
  parseStructured,
  schemaErrorMessage,
  structuredFailure,
  structuredRetryMessages,
} from './structured';

export interface LlmCallRecord {
  provider: string;
  model: string;
  callKind: string;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  latencyMs: number;
  ok: boolean;
  error?: string;
  /** Per-call audit context (ai-safety.md item 9) supplied by the caller. */
  promptId?: string | null;
  promptVersion?: string | null;
  promptHash?: string | null;
  sensitivity?: string | null;
  agentRole?: string | null;
  /** Pre-flight `js-tiktoken` estimate (audit only; authoritative count is usage). */
  estimatedPromptTokens?: number | null;
  /** Structured-output validation outcome for this attempt. */
  validation?: CallValidation | null;
  cacheHit?: boolean;
}

export type LlmCallHook = (record: LlmCallRecord) => void | Promise<void>;

/** Default per-call input cap (ai-safety.md item 9): 32k input + 4k output. */
export const DEFAULT_MAX_INPUT_TOKENS = 32_000;
/** Default max output tokens when a caller does not override. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 4_096;

export interface OpenAICompatibleConfig {
  /** Provider id used for audit rows + pricing lookup, e.g. 'openai'. */
  name: string;
  apiKey?: string | undefined;
  /** Full base URL including the version suffix, e.g. https://api.openai.com/v1. */
  baseUrl: string;
  chatModel: string;
  onCall?: LlmCallHook | undefined;
  allowlist?: string[] | undefined;
  maxTokens?: number | undefined;
  /** Pre-flight input-token cap. Defaults to {@link DEFAULT_MAX_INPUT_TOKENS}. */
  maxInputTokens?: number | undefined;
  capabilities?: ProviderCapabilities | undefined;
  /**
   * `json_schema` sends a strict schema derived from the Zod schema when
   * convertible; `json_object` sends the bare response_format. Both still
   * Zod-validate + retry once.
   */
  structuredMode?: 'json_object' | 'json_schema' | undefined;
  /** Test seam mirroring shared/net; never wired from user input. */
  lookup?: AssertPublicUrlOptions['lookup'];
  /** Permit loopback hosts (local model runtimes only). */
  allowLocal?: boolean | undefined;
}

interface OpenAIChoice {
  message?: { content?: string; tool_calls?: unknown };
  delta?: { content?: string };
}

interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface OpenAIResponse {
  choices: OpenAIChoice[];
  usage?: OpenAIUsage;
  error?: { message: string };
}

export const OPENAI_COMPATIBLE_DEFAULT_CAPABILITIES: ProviderCapabilities = {
  structuredOutput: true,
  streaming: false,
  toolUse: false,
  contextWindow: 128_000,
  embeddings: false,
};

/**
 * OpenAI Chat Completions adapter. Works for OpenAI and any OpenAI-compatible
 * base URL (OpenRouter, vLLM, LiteLLM, Groq, …). DeepSeek subclasses this to
 * share the request/structured/retry path; the only differences are defaults,
 * capabilities, and the extra wizard test calls.
 */
export class OpenAICompatibleProvider implements AIProvider {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;
  protected readonly base: string;
  protected readonly chatModel: string;
  protected readonly apiKey: string | undefined;
  protected readonly allowlist: string[];
  protected readonly defaultMaxTokens: number;
  protected readonly maxInputTokens: number;
  protected readonly onCall: LlmCallHook | undefined;
  private readonly structuredMode: 'json_object' | 'json_schema';
  private readonly lookup: AssertPublicUrlOptions['lookup'];
  private readonly allowLocal: boolean;
  private baseUrlValidated: Promise<void> | null = null;

  constructor(cfg: OpenAICompatibleConfig) {
    this.name = cfg.name;
    this.base = cfg.baseUrl.replace(/\/$/, '');
    this.chatModel = cfg.chatModel;
    this.apiKey = cfg.apiKey;
    this.allowlist = cfg.allowlist ?? [];
    this.defaultMaxTokens = cfg.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    this.maxInputTokens = cfg.maxInputTokens ?? DEFAULT_MAX_INPUT_TOKENS;
    this.capabilities = cfg.capabilities ?? OPENAI_COMPATIBLE_DEFAULT_CAPABILITIES;
    this.structuredMode = cfg.structuredMode ?? 'json_object';
    this.lookup = cfg.lookup;
    this.allowLocal = cfg.allowLocal ?? false;
    this.onCall = cfg.onCall;
    // Sync shape check at construction so an obviously-bad baseUrl fails before
    // any prompt tokens spend; full DNS check runs before the first fetch.
    assertPublicUrlShape(this.base, { allowlist: this.allowlist });
  }

  get maxTokens(): number {
    return this.defaultMaxTokens;
  }

  protected async ensureBaseUrlSafe(): Promise<void> {
    if (this.allowLocal) return;
    if (!this.baseUrlValidated) {
      this.baseUrlValidated = assertPublicUrl(this.base, {
        allowlist: this.allowlist,
        ...(this.lookup ? { lookup: this.lookup } : {}),
      }).then(() => undefined);
    }
    await this.baseUrlValidated;
  }

  async chat(input: {
    messages: ChatMessage[];
    temperature?: number;
    maxTokens?: number;
    meta?: LlmCallMeta;
  }): Promise<string> {
    const maxTokens = input.maxTokens ?? this.defaultMaxTokens;
    const estimated = this.preflight(input.messages, maxTokens);
    const r = await this.send('/chat/completions', {
      model: this.chatModel,
      messages: input.messages,
      temperature: input.temperature ?? 0.2,
      max_tokens: maxTokens,
    });
    if (!r.ok) {
      this.emit(this.record(r.latencyMs, 'chat', null, null, null, false, r.error, 'not_applicable', estimated, input.meta));
      throw r.cause;
    }
    this.emit(this.record(r.latencyMs, 'chat', r.json.usage?.prompt_tokens ?? null, r.json.usage?.completion_tokens ?? null, r.json.usage?.total_tokens ?? null, true, undefined, 'not_applicable', estimated, input.meta));
    return r.json.choices[0]?.message?.content ?? '';
  }

  async chatStructured<S extends z.ZodTypeAny>(input: {
    messages: ChatMessage[];
    schema: S;
    temperature?: number;
    maxTokens?: number;
    meta?: LlmCallMeta;
  }): Promise<z.output<S>> {
    const maxTokens = input.maxTokens ?? this.defaultMaxTokens;
    const estimated = this.preflight(input.messages, maxTokens);
    const body = {
      model: this.chatModel,
      messages: input.messages,
      temperature: input.temperature ?? 0,
      response_format: this.responseFormat(input.schema),
      max_tokens: maxTokens,
    };
    const first = await this.send('/chat/completions', body);
    if (!first.ok) {
      this.emit(this.record(first.latencyMs, 'chatStructured', null, null, null, false, first.error, 'failed', estimated, input.meta));
      throw first.cause;
    }
    const raw = first.json.choices[0]?.message?.content ?? '{}';
    const tokens = this.tokensOf(first.json);
    try {
      const parsed = parseStructured(input.schema, raw);
      this.emit(this.record(first.latencyMs, 'chatStructured', tokens.prompt, tokens.completion, tokens.total, true, undefined, 'passed', estimated, input.meta));
      return parsed;
    } catch (err) {
      const parseFailure = isSchemaParseFailure(err);
      this.emit(this.record(first.latencyMs, 'chatStructured', tokens.prompt, tokens.completion, tokens.total, parseFailure, parseFailure ? undefined : (err as Error).message, 'failed', estimated, input.meta));
      if (!parseFailure) throw err;
      const retryMessages = structuredRetryMessages(input.messages, raw, schemaErrorMessage(err));
      const retry = await this.send('/chat/completions', { ...body, messages: retryMessages });
      if (!retry.ok) {
        this.emit(this.record(retry.latencyMs, 'chatStructured:retry', null, null, null, false, retry.error, 'failed', estimated, input.meta));
        throw retry.cause;
      }
      const retryRaw = retry.json.choices[0]?.message?.content ?? '{}';
      const retryTokens = this.tokensOf(retry.json);
      try {
        const parsed = parseStructured(input.schema, retryRaw);
        this.emit(this.record(retry.latencyMs, 'chatStructured:retry', retryTokens.prompt, retryTokens.completion, retryTokens.total, true, undefined, 'passed', estimated, input.meta));
        return parsed;
      } catch (err2) {
        this.emit(this.record(retry.latencyMs, 'chatStructured:retry', retryTokens.prompt, retryTokens.completion, retryTokens.total, true, undefined, 'failed', estimated, input.meta));
        throw structuredFailure(err2);
      }
    }
  }

  /**
   * Pre-flight cap (ai-safety.md item 9): reject before any egress when the
   * estimated prompt + requested output exceeds the per-call input cap. Returns
   * the estimate so it can be persisted on the audit row.
   */
  protected preflight(messages: ChatMessage[], maxOutputTokens: number): number {
    const estimated = estimateMessagesTokens(messages, this.chatModel);
    if (estimated + maxOutputTokens > this.maxInputTokens) {
      throw new TokenCapExceededError(estimated, maxOutputTokens, this.maxInputTokens);
    }
    return estimated;
  }

  private tokensOf(json: OpenAIResponse): {
    prompt: number | null;
    completion: number | null;
    total: number | null;
  } {
    return {
      prompt: json.usage?.prompt_tokens ?? null,
      completion: json.usage?.completion_tokens ?? null,
      total: json.usage?.total_tokens ?? null,
    };
  }

  async probe(): Promise<ProviderProbeResult> {
    const t0 = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort('probe_timeout'), 3_000);
    try {
      const headers: Record<string, string> = {};
      if (this.apiKey) headers['authorization'] = `Bearer ${this.apiKey}`;
      const res = await providerFetch(
        `${this.base}/models`,
        { method: 'GET', headers, signal: controller.signal },
        { allowlist: this.allowlist, allowLocal: this.allowLocal, lookup: this.lookup },
      );
      const latencyMs = Date.now() - t0;
      if (!res.ok) return { reachable: false, latencyMs, error: `HTTP ${res.status}` };
      return { reachable: true, latencyMs };
    } catch (err) {
      const msg = (err as Error).message || 'probe_failed';
      return {
        reachable: false,
        latencyMs: Date.now() - t0,
        error: msg === 'probe_timeout' ? 'timeout' : msg,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private responseFormat(schema: z.ZodTypeAny): Record<string, unknown> {
    if (this.structuredMode === 'json_schema') {
      const jsonSchema = zodToJsonSchemaObject(schema);
      if (jsonSchema) {
        return {
          type: 'json_schema',
          json_schema: { name: `${this.name}_output`, schema: jsonSchema },
        };
      }
    }
    return { type: 'json_object' };
  }

  /**
   * Raw HTTP send. Does NOT emit an audit row — callers own the emit so they can
   * attach the correct structured-validation verdict (a schema failure is not an
   * HTTP failure). Kept separate from `request` so the wizard test methods keep
   * their existing one-emit-per-HTTP-request behavior.
   */
  protected async send(
    path: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<
    | { ok: true; json: OpenAIResponse; latencyMs: number }
    | { ok: false; latencyMs: number; error: string; cause: unknown }
  > {
    await this.ensureBaseUrlSafe();
    const t0 = Date.now();
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.apiKey) headers['authorization'] = `Bearer ${this.apiKey}`;
    const init: RequestInit = {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      // Manual so a 3xx to 169.254.169.254 does not silently follow; the fetch
      // helper re-validates every Location hop.
      redirect: 'manual',
    };
    if (signal) init.signal = signal;
    try {
      const res = await providerFetch(
        `${this.base}${path}`,
        init,
        { allowlist: this.allowlist, allowLocal: this.allowLocal, lookup: this.lookup },
      );
      const json = (await res.json()) as OpenAIResponse;
      if (!res.ok) {
        const upstream = json.error?.message ?? `HTTP ${res.status}`;
        return {
          ok: false,
          latencyMs: Date.now() - t0,
          error: upstream,
          cause: new LLMProviderError('LLM provider error', upstream),
        };
      }
      return { ok: true, json, latencyMs: Date.now() - t0 };
    } catch (err) {
      const raw = err instanceof LLMProviderError ? err.upstream : (err as Error).message;
      return { ok: false, latencyMs: Date.now() - t0, error: raw, cause: err };
    }
  }

  /** Send + emit in one step. Used by the wizard capability test calls. */
  protected async request(
    path: string,
    body: Record<string, unknown>,
    callKind: string,
    signal?: AbortSignal,
    meta?: LlmCallMeta,
  ): Promise<OpenAIResponse> {
    const r = await this.send(path, body, signal);
    if (!r.ok) {
      this.emit(this.record(r.latencyMs, callKind, null, null, null, false, r.error, 'not_applicable', null, meta));
      throw r.cause;
    }
    this.emit(this.record(r.latencyMs, callKind, r.json.usage?.prompt_tokens ?? null, r.json.usage?.completion_tokens ?? null, r.json.usage?.total_tokens ?? null, true, undefined, 'not_applicable', null, meta));
    return r.json;
  }

  /** Build one audit row, stamping caller-supplied prompt context + provider facts. */
  protected record(
    latencyMs: number,
    callKind: string,
    promptTokens: number | null,
    completionTokens: number | null,
    totalTokens: number | null,
    ok: boolean,
    error: string | undefined,
    validation: CallValidation,
    estimatedPromptTokens: number | null,
    meta: LlmCallMeta | undefined,
  ): LlmCallRecord {
    return {
      provider: this.name,
      model: this.chatModel,
      callKind,
      promptTokens,
      completionTokens,
      totalTokens,
      latencyMs,
      ok,
      ...(error ? { error } : {}),
      promptId: meta?.promptId ?? null,
      promptVersion: meta?.promptVersion ?? null,
      promptHash: meta?.promptHash ?? null,
      sensitivity: meta?.sensitivity ?? null,
      agentRole: meta?.agentRole ?? null,
      estimatedPromptTokens,
      validation,
      ...(meta?.cacheHit !== undefined ? { cacheHit: meta.cacheHit } : {}),
    };
  }

  protected emit(record: LlmCallRecord): void {
    if (!this.onCall) return;
    Promise.resolve()
      .then(() => this.onCall!(record))
      .catch(() => {
        /* audit is fire-and-forget; never affect the caller */
      });
  }
}

/** Default OpenAI-compatible base URLs per provider id. */
export function defaultBaseUrlFor(provider: string): string | undefined {
  switch (provider) {
    case 'openai':
      return 'https://api.openai.com/v1';
    case 'openrouter':
      return 'https://openrouter.ai/api/v1';
    default:
      return undefined;
  }
}
