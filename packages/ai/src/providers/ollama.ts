import { type z } from 'zod';
import { assertPublicUrlShape } from '@careeros/shared/net';
import type {
  AIProvider,
  ChatMessage,
  ProviderCapabilities,
  ProviderProbeResult,
} from '../provider';
import { LLMProviderError } from '../errors';
import { providerFetch } from './fetch';
import { zodToJsonSchemaObject } from './json-schema';
import type { LlmCallHook, LlmCallRecord } from './openai-compatible';
import {
  isSchemaParseFailure,
  parseStructured,
  schemaErrorMessage,
  structuredFailure,
  structuredRetryMessages,
} from './structured';

export interface OllamaConfig {
  /** Native Ollama API base, e.g. http://localhost:11434 (the default). */
  baseUrl?: string | undefined;
  chatModel: string;
  onCall?: LlmCallHook | undefined;
  /** Per-call default for `options.num_predict`. */
  maxTokens?: number | undefined;
  /** Model-specific override; only used as a conservative default elsewhere. */
  contextWindow?: number | undefined;
  /** Extra allowlisted hosts for a LAN Ollama (e.g. ollama.internal). */
  allowlist?: string[] | undefined;
}

const OLLAMA_DEFAULT_BASE = 'http://localhost:11434';

// Conservative floor for a 7B-class local model (llama3.1 is 128k, qwen2.5 32k,
// but the adapter cannot know which model the user pulled). Structured output
// uses Ollama's native JSON-schema `format`; no key, no cloud egress. Tool use
// and SSE streaming exist in current Ollama but the AIProvider surface has no
// streaming method yet, so both report false — same honesty rule as DeepSeek.
const OLLAMA_CAPABILITIES: ProviderCapabilities = {
  structuredOutput: true,
  streaming: false,
  toolUse: false,
  contextWindow: 8_192,
  embeddings: false,
};

interface OllamaNativeResponse {
  message?: { role?: string; content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
  done?: boolean;
  error?: string;
}

/**
 * Local Ollama adapter over the native `/api/chat` API (not the OpenAI-compat
 * shim) because only the native response exposes `prompt_eval_count` /
 * `eval_count` for token accounting. No API key; loopback/allowlisted hosts
 * only, enforced by `providerFetch({ allowLocal: true })`.
 */
export class OllamaProvider implements AIProvider {
  readonly name = 'ollama';
  readonly capabilities: ProviderCapabilities;
  private readonly base: string;
  private readonly chatModel: string;
  private readonly defaultMaxTokens: number;
  private readonly allowlist: string[];
  private readonly onCall: LlmCallHook | undefined;

  constructor(cfg: OllamaConfig) {
    this.base = (cfg.baseUrl ?? OLLAMA_DEFAULT_BASE).replace(/\/$/, '');
    this.chatModel = cfg.chatModel;
    this.defaultMaxTokens = cfg.maxTokens ?? 4096;
    this.allowlist = cfg.allowlist ?? [];
    this.capabilities = {
      ...OLLAMA_CAPABILITIES,
      contextWindow: cfg.contextWindow ?? OLLAMA_CAPABILITIES.contextWindow,
    };
    this.onCall = cfg.onCall;
    // Sync shape check at construction; the fetch path re-checks per call.
    assertPublicUrlShape(
      this.base,
      this.allowlist.length > 0 ? { allowlist: this.allowlist } : {},
    );
  }

  get maxTokens(): number {
    return this.defaultMaxTokens;
  }

  async chat(input: {
    messages: ChatMessage[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<string> {
    const res = await this.request(
      '/api/chat',
      {
        model: this.chatModel,
        messages: input.messages,
        stream: false,
        options: {
          temperature: input.temperature ?? 0.2,
          num_predict: input.maxTokens ?? this.defaultMaxTokens,
        },
      },
      'chat',
    );
    return res.message?.content ?? '';
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
      stream: false,
      format: this.format(input.schema),
      options: {
        temperature: input.temperature ?? 0,
        num_predict: input.maxTokens ?? this.defaultMaxTokens,
      },
    };
    const res = await this.request('/api/chat', body, 'chatStructured');
    const raw = res.message?.content ?? '{}';
    try {
      return parseStructured(input.schema, raw);
    } catch (err) {
      if (!isSchemaParseFailure(err)) throw err;
      const retryRes = await this.request(
        '/api/chat',
        {
          ...body,
          messages: structuredRetryMessages(input.messages, raw, schemaErrorMessage(err)),
        },
        'chatStructured:retry',
      );
      try {
        return parseStructured(input.schema, retryRes.message?.content ?? '{}');
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
      const res = await this.fetch(`${this.base}/api/tags`, {
        method: 'GET',
        signal: controller.signal,
      });
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

  /** Native `format`: a JSON schema when representable, else bare JSON mode. */
  private format(schema: z.ZodTypeAny): 'json' | Record<string, unknown> {
    return zodToJsonSchemaObject(schema) ?? 'json';
  }

  private fetch(url: string, init: RequestInit): Promise<Response> {
    return providerFetch(url, init, {
      allowLocal: true,
      ...(this.allowlist.length > 0 ? { allowlist: this.allowlist } : {}),
    });
  }

  private async request(
    path: string,
    body: Record<string, unknown>,
    callKind: string,
  ): Promise<OllamaNativeResponse> {
    const t0 = Date.now();
    try {
      const res = await this.fetch(`${this.base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let json: OllamaNativeResponse = {};
      if (text) {
        try {
          json = JSON.parse(text) as OllamaNativeResponse;
        } catch {
          json = { error: text.slice(0, 200) };
        }
      }
      if (!res.ok) {
        throw new LLMProviderError('LLM provider error', json.error ?? `HTTP ${res.status}`);
      }
      this.emit({
        provider: this.name,
        model: this.chatModel,
        callKind,
        promptTokens: json.prompt_eval_count ?? null,
        completionTokens: json.eval_count ?? null,
        totalTokens:
          json.prompt_eval_count != null && json.eval_count != null
            ? json.prompt_eval_count + json.eval_count
            : null,
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

  private emit(record: LlmCallRecord): void {
    if (!this.onCall) return;
    Promise.resolve()
      .then(() => this.onCall!(record))
      .catch(() => {
        /* audit is fire-and-forget; never affect the caller */
      });
  }
}
