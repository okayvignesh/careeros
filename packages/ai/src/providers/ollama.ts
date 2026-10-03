import { type z } from 'zod';
import { assertPublicUrlShape } from '@careeros/shared/net';
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
  DEFAULT_MAX_INPUT_TOKENS,
  DEFAULT_MAX_OUTPUT_TOKENS,
  type LlmCallHook,
  type LlmCallRecord,
} from './openai-compatible';
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
  /** Pre-flight input-token cap. Defaults to `DEFAULT_MAX_INPUT_TOKENS`. */
  maxInputTokens?: number | undefined;
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
  private readonly maxInputTokens: number;
  private readonly allowlist: string[];
  private readonly onCall: LlmCallHook | undefined;

  constructor(cfg: OllamaConfig) {
    this.base = (cfg.baseUrl ?? OLLAMA_DEFAULT_BASE).replace(/\/$/, '');
    this.chatModel = cfg.chatModel;
    this.defaultMaxTokens = cfg.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    this.maxInputTokens = cfg.maxInputTokens ?? DEFAULT_MAX_INPUT_TOKENS;
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
    meta?: LlmCallMeta;
  }): Promise<string> {
    const numPredict = input.maxTokens ?? this.defaultMaxTokens;
    const estimated = this.preflight(input.messages, numPredict);
    const r = await this.send('/api/chat', {
      model: this.chatModel,
      messages: input.messages,
      stream: false,
      options: { temperature: input.temperature ?? 0.2, num_predict: numPredict },
    });
    if (!r.ok) {
      this.emit(this.record(r.latencyMs, 'chat', null, null, null, false, r.error, 'not_applicable', estimated, input.meta));
      throw r.cause;
    }
    this.emit(this.record(r.latencyMs, 'chat', r.json.prompt_eval_count ?? null, r.json.eval_count ?? null, this.total(r.json), true, undefined, 'not_applicable', estimated, input.meta));
    return r.json.message?.content ?? '';
  }

  async chatStructured<S extends z.ZodTypeAny>(input: {
    messages: ChatMessage[];
    schema: S;
    temperature?: number;
    maxTokens?: number;
    meta?: LlmCallMeta;
  }): Promise<z.output<S>> {
    const numPredict = input.maxTokens ?? this.defaultMaxTokens;
    const estimated = this.preflight(input.messages, numPredict);
    const body = {
      model: this.chatModel,
      messages: input.messages,
      stream: false,
      format: this.format(input.schema),
      options: { temperature: input.temperature ?? 0, num_predict: numPredict },
    };
    const first = await this.send('/api/chat', body);
    if (!first.ok) {
      this.emit(this.record(first.latencyMs, 'chatStructured', null, null, null, false, first.error, 'failed', estimated, input.meta));
      throw first.cause;
    }
    const raw = first.json.message?.content ?? '{}';
    try {
      const parsed = parseStructured(input.schema, raw);
      this.emit(this.record(first.latencyMs, 'chatStructured', first.json.prompt_eval_count ?? null, first.json.eval_count ?? null, this.total(first.json), true, undefined, 'passed', estimated, input.meta));
      return parsed;
    } catch (err) {
      const parseFailure = isSchemaParseFailure(err);
      this.emit(this.record(first.latencyMs, 'chatStructured', first.json.prompt_eval_count ?? null, first.json.eval_count ?? null, this.total(first.json), parseFailure, parseFailure ? undefined : (err as Error).message, 'failed', estimated, input.meta));
      if (!parseFailure) throw err;
      const retry = await this.send('/api/chat', {
        ...body,
        messages: structuredRetryMessages(input.messages, raw, schemaErrorMessage(err)),
      });
      if (!retry.ok) {
        this.emit(this.record(retry.latencyMs, 'chatStructured:retry', null, null, null, false, retry.error, 'failed', estimated, input.meta));
        throw retry.cause;
      }
      try {
        const parsed = parseStructured(input.schema, retry.json.message?.content ?? '{}');
        this.emit(this.record(retry.latencyMs, 'chatStructured:retry', retry.json.prompt_eval_count ?? null, retry.json.eval_count ?? null, this.total(retry.json), true, undefined, 'passed', estimated, input.meta));
        return parsed;
      } catch (err2) {
        this.emit(this.record(retry.latencyMs, 'chatStructured:retry', retry.json.prompt_eval_count ?? null, retry.json.eval_count ?? null, this.total(retry.json), true, undefined, 'failed', estimated, input.meta));
        throw structuredFailure(err2);
      }
    }
  }

  /** Pre-flight cap (ai-safety.md item 9); returns the estimate for the audit row. */
  private preflight(messages: ChatMessage[], maxOutputTokens: number): number {
    const estimated = estimateMessagesTokens(messages, this.chatModel);
    if (estimated + maxOutputTokens > this.maxInputTokens) {
      throw new TokenCapExceededError(estimated, maxOutputTokens, this.maxInputTokens);
    }
    return estimated;
  }

  private total(json: OllamaNativeResponse): number | null {
    return json.prompt_eval_count != null && json.eval_count != null
      ? json.prompt_eval_count + json.eval_count
      : null;
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

  /** Raw HTTP send; callers own emit so they can stamp the validation verdict. */
  private async send(
    path: string,
    body: Record<string, unknown>,
  ): Promise<
    | { ok: true; json: OllamaNativeResponse; latencyMs: number }
    | { ok: false; latencyMs: number; error: string; cause: unknown }
  > {
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
        const upstream = json.error ?? `HTTP ${res.status}`;
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

  private record(
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

  private emit(record: LlmCallRecord): void {
    if (!this.onCall) return;
    Promise.resolve()
      .then(() => this.onCall!(record))
      .catch(() => {
        /* audit is fire-and-forget; never affect the caller */
      });
  }
}
