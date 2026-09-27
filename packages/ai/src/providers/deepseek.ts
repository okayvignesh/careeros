import type { AIProvider, ChatMessage, ProviderCapabilities } from '../provider';
import type { z } from 'zod';

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

interface DeepSeekConfig {
  apiKey: string;
  baseUrl?: string | undefined;
  chatModel: string;
  onCall?: LlmCallHook | undefined;
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

interface OpenAIResponse {
  choices: OpenAIChoice[];
  usage?: OpenAIUsage;
  error?: { message: string };
}

export class DeepSeekProvider implements AIProvider {
  readonly name = 'deepseek';
  private readonly base: string;

  constructor(private readonly cfg: DeepSeekConfig) {
    this.base = (cfg.baseUrl ?? 'https://api.deepseek.com/v1').replace(/\/$/, '');
  }

  async chat({
    messages,
    temperature = 0.2,
  }: {
    messages: ChatMessage[];
    temperature?: number;
  }): Promise<string> {
    const res = await this.request(
      '/chat/completions',
      { model: this.cfg.chatModel, messages, temperature },
      'chat',
    );
    return res.choices[0]?.message?.content ?? '';
  }

  async chatStructured<S extends z.ZodTypeAny>({
    messages,
    schema,
    temperature = 0,
  }: {
    messages: ChatMessage[];
    schema: S;
    temperature?: number;
  }): Promise<z.output<S>> {
    const res = await this.request(
      '/chat/completions',
      {
        model: this.cfg.chatModel,
        messages,
        temperature,
        response_format: { type: 'json_object' },
      },
      'chatStructured',
    );
    const raw = res.choices[0]?.message?.content ?? '{}';
    return schema.parse(JSON.parse(raw)) as z.output<S>;
  }

  async probeCapabilities(): Promise<ProviderCapabilities> {
    return { chat: true, structuredOutput: true, tools: true, streaming: true };
  }

  async testChat(signal?: AbortSignal): Promise<string> {
    const res = await this.request(
      '/chat/completions',
      {
        model: this.cfg.chatModel,
        messages: [{ role: 'user', content: 'Reply with just the word: pong' }],
      },
      'test:chat',
      signal,
    );
    return res.choices[0]?.message?.content ?? '';
  }

  async testStructured(signal?: AbortSignal): Promise<unknown> {
    const res = await this.request(
      '/chat/completions',
      {
        model: this.cfg.chatModel,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content:
              'You return JSON. Respond with an object matching: {"ok": true, "value": <number>}',
          },
          { role: 'user', content: 'Return ok=true and value=42.' },
        ],
        response_format: { type: 'json_object' },
      },
      'test:structured',
      signal,
    );
    return JSON.parse(res.choices[0]?.message?.content ?? '{}');
  }

  async testTools(signal?: AbortSignal): Promise<unknown> {
    const res = await this.request(
      '/chat/completions',
      {
        model: this.cfg.chatModel,
        temperature: 0,
        messages: [{ role: 'user', content: 'Use the get_time tool.' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_time',
              description: 'Returns current time',
              parameters: { type: 'object', properties: {}, required: [] },
            },
          },
        ],
        tool_choice: 'auto',
      },
      'test:tools',
      signal,
    );
    const call = res.choices[0]?.message?.tool_calls;
    if (!call) throw new Error('provider did not emit a tool call');
    return call;
  }

  async testStreaming(signal?: AbortSignal): Promise<string> {
    const t0 = Date.now();
    const init: RequestInit = {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: this.cfg.chatModel,
        temperature: 0,
        stream: true,
        messages: [{ role: 'user', content: 'Say pong.' }],
      }),
    };
    if (signal) init.signal = signal;
    try {
      const res = await fetch(`${this.base}/chat/completions`, init);
      if (!res.ok || !res.body) throw new Error(`stream HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let received = '';
      let chunks = 0;
      while (chunks < 3) {
        const { done, value } = await reader.read();
        if (done) break;
        received += decoder.decode(value);
        chunks++;
      }
      reader.cancel();
      if (!received.includes('data:')) throw new Error('no SSE frames received');
      this.emit({
        provider: this.name,
        model: this.cfg.chatModel,
        callKind: 'test:streaming',
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        latencyMs: Date.now() - t0,
        ok: true,
      });
      return received.slice(0, 200);
    } catch (err) {
      this.emit({
        provider: this.name,
        model: this.cfg.chatModel,
        callKind: 'test:streaming',
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        latencyMs: Date.now() - t0,
        ok: false,
        error: (err as Error).message,
      });
      throw err;
    }
  }

  private async request(
    path: string,
    body: Record<string, unknown>,
    callKind: string,
    signal?: AbortSignal,
  ): Promise<OpenAIResponse> {
    const t0 = Date.now();
    const init: RequestInit = {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.cfg.apiKey}`,
      },
      body: JSON.stringify(body),
    };
    if (signal) init.signal = signal;
    try {
      const res = await fetch(`${this.base}${path}`, init);
      const json = (await res.json()) as OpenAIResponse;
      if (!res.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
      this.emit({
        provider: this.name,
        model: this.cfg.chatModel,
        callKind,
        promptTokens: json.usage?.prompt_tokens ?? null,
        completionTokens: json.usage?.completion_tokens ?? null,
        totalTokens: json.usage?.total_tokens ?? null,
        latencyMs: Date.now() - t0,
        ok: true,
      });
      return json;
    } catch (err) {
      this.emit({
        provider: this.name,
        model: this.cfg.chatModel,
        callKind,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        latencyMs: Date.now() - t0,
        ok: false,
        error: (err as Error).message,
      });
      throw err;
    }
  }

  private emit(record: LlmCallRecord): void {
    if (!this.cfg.onCall) return;
    // Fire and forget. Never let audit failures affect the caller.
    Promise.resolve()
      .then(() => this.cfg.onCall!(record))
      .catch(() => {
        /* swallow */
      });
  }
}
