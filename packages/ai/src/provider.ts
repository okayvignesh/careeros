import type { z } from 'zod';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ProviderCapabilities {
  chat: boolean;
  structuredOutput: boolean;
  tools: boolean;
  streaming: boolean;
}

/**
 * Provider-agnostic contract. Adapters implement this per provider.
 * Real DeepSeek/OpenAI/Ollama adapters land in iteration 2.
 */
export interface AIProvider {
  readonly name: string;

  chat(input: { messages: ChatMessage[]; temperature?: number }): Promise<string>;

  chatStructured<S extends z.ZodTypeAny>(input: {
    messages: ChatMessage[];
    schema: S;
    temperature?: number;
  }): Promise<z.output<S>>;

  probeCapabilities(): Promise<ProviderCapabilities>;
}
