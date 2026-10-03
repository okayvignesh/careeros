import { type z } from 'zod';
import { assertPublicUrl, assertPublicUrlShape } from '@careeros/shared/net';
import type { AssertPublicUrlOptions } from '@careeros/shared/net';
import type {
  AIProvider,
  ChatMessage,
  ProviderCapabilities,
  ProviderProbeResult,
} from '../provider';
import { LLMProviderError } from '../errors';
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
}

export type LlmCallHook = (record: LlmCallRecord) => void | Promise<void>;

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
    this.defaultMaxTokens = cfg.maxTokens ?? 4096;
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
  }): Promise<string> {
    const res = await this.request(
      '/chat/completions',
      {
        model: this.chatModel,
        messages: input.messages,
        temperature: input.temperature ?? 0.2,
        max_tokens: input.maxTokens ?? this.defaultMaxTokens,
      },
      'chat',
    );
    return res.choices[0]?.message?.content ?? '';
  }

  async chatStructured<S extends z.ZodTypeAny>(input: {
    messages: ChatMessage[];
    schema: S;
    temperature?: number;
    maxTokens?: number;
  }): Promise<z.output<S>> {
    const body = {
      model: this.chatModel,
      messages: input.messages,
      temperature: input.temperature ?? 0,
      response_format: this.responseFormat(input.schema),
      max_tokens: input.maxTokens ?? this.defaultMaxTokens,
    };
    const res = await this.request('/chat/completions', body, 'chatStructured');
    const raw = res.choices[0]?.message?.content ?? '{}';
    try {
      return parseStructured(input.schema, raw);
    } catch (err) {
      if (!isSchemaParseFailure(err)) throw err;
      const retryMessages = structuredRetryMessages(input.messages, raw, schemaErrorMessage(err));
      const retryRes = await this.request(
        '/chat/completions',
        { ...body, messages: retryMessages },
        'chatStructured:retry',
      );
      const retryRaw = retryRes.choices[0]?.message?.content ?? '{}';
      try {
        return parseStructured(input.schema, retryRaw);
      } catch (err2) {
        throw structuredFailure(err2);
      }
    }
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

  protected async request(
    path: string,
    body: Record<string, unknown>,
    callKind: string,
    signal?: AbortSignal,
  ): Promise<OpenAIResponse> {
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
        throw new LLMProviderError('LLM provider error', upstream);
      }
      this.emit({
        provider: this.name,
        model: this.chatModel,
        callKind,
        promptTokens: json.usage?.prompt_tokens ?? null,
        completionTokens: json.usage?.completion_tokens ?? null,
        totalTokens: json.usage?.total_tokens ?? null,
        latencyMs: Date.now() - t0,
        ok: true,
      });
      return json;
    } catch (err) {
      const raw = err instanceof LLMProviderError ? err.upstream : (err as Error).message;
      this.emit({
        provider: this.name,
        model: this.chatModel,
        callKind,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        latencyMs: Date.now() - t0,
        ok: false,
        error: raw,
      });
      throw err;
    }
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
