import { safeFetch } from '@careeros/shared/net';
import type { ChatMessage, ProviderCapabilities } from '../provider';
import {
  OpenAICompatibleProvider,
  type LlmCallHook,
  type LlmCallRecord,
} from './openai-compatible';

export type { LlmCallRecord, LlmCallHook } from './openai-compatible';

interface DeepSeekConfig {
  apiKey: string;
  baseUrl?: string | undefined;
  chatModel: string;
  onCall?: LlmCallHook | undefined;
  /** Extra hostnames to allow (self-hosted proxy, etc). */
  allowlist?: string[] | undefined;
  /** Per-call max output tokens. Defaults to 4096 in chat/chatStructured. */
  maxTokens?: number | undefined;
}

// Real values, not aspirational. DeepSeek exposes JSON mode; SSE streaming is
// available on chat/completions but the AIProvider surface has no streaming
// method yet (probe.ts testStreaming covers the wizard). Embeddings live on a
// separate adapter. contextWindow = deepseek-chat (v3) 65,536 tokens.
const DEEPSEEK_CAPABILITIES: ProviderCapabilities = {
  structuredOutput: true,
  streaming: false,
  toolUse: false,
  contextWindow: 65_536,
  embeddings: false,
};

/**
 * DeepSeek is OpenAI-compatible, so the request/structured/retry/probe logic
 * lives in OpenAICompatibleProvider. This subclass pins DeepSeek defaults and
 * adds the wizard's four capability test calls.
 */
export class DeepSeekProvider extends OpenAICompatibleProvider {
  constructor(cfg: DeepSeekConfig) {
    super({
      name: 'deepseek',
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl ?? 'https://api.deepseek.com/v1',
      chatModel: cfg.chatModel,
      onCall: cfg.onCall,
      allowlist: cfg.allowlist,
      maxTokens: cfg.maxTokens,
      capabilities: DEEPSEEK_CAPABILITIES,
      structuredMode: 'json_object',
    });
  }

  async testChat(signal?: AbortSignal): Promise<string> {
    const res = await this.request(
      '/chat/completions',
      {
        model: this.chatModel,
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
        model: this.chatModel,
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
        model: this.chatModel,
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
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.chatModel,
        temperature: 0,
        stream: true,
        messages: [{ role: 'user', content: 'Say pong.' }],
      }),
    };
    if (signal) init.signal = signal;
    try {
      const res = await safeFetch(`${this.base}/chat/completions`, init, {
        allowlist: this.allowlist,
      });
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
        model: this.chatModel,
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
        model: this.chatModel,
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
}
