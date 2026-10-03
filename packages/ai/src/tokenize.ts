// Pre-flight token estimation (ai-safety.md item 9). Uses `js-tiktoken` to
// approximate the prompt cost BEFORE dispatch so we can enforce per-call caps
// and surface an `estimatedPromptTokens` value on the audit row. This is a
// guardrail, not accounting: the authoritative count is the provider's
// `usage.prompt_tokens` (or Ollama's `prompt_eval_count`).
//
// Encoding selection follows the spec: cl100k_base for DeepSeek / GPT-3.5 / GPT-4,
// o200k_base for the GPT-4o / o-series families. Everything else falls back to
// cl100k_base — within ~5-10% for the models we ship, which is enough to catch a
// runaway prompt.
import { getEncoding, type Tiktoken } from 'js-tiktoken';
import type { ChatMessage } from './provider';

export type TiktokenEncoding = 'cl100k_base' | 'o200k_base';

/** Map a provider model id to the closest tiktoken encoding. */
export function encodingNameForModel(model: string): TiktokenEncoding {
  const m = model.toLowerCase();
  // o200k_base family: gpt-4o*, o1*, o3*, gpt-4.1*.
  if (/^(gpt-4o|o1|o3|gpt-4\.1)/.test(m)) return 'o200k_base';
  return 'cl100k_base';
}

const encoderCache = new Map<TiktokenEncoding, Tiktoken>();

function encoderFor(model: string): Tiktoken {
  const name = encodingNameForModel(model);
  let enc = encoderCache.get(name);
  if (!enc) {
    enc = getEncoding(name);
    encoderCache.set(name, enc);
  }
  return enc;
}

/**
 * Approximate token count for a string under the encoding closest to `model`.
 * Empty / non-string input is 0.
 */
export function estimateTokens(text: string, model: string): number {
  if (typeof text !== 'string' || text.length === 0) return 0;
  return encoderFor(model).encode(text).length;
}

/**
 * Approximate prompt tokens for a chat-completions `messages` array. Each
 * message costs its content plus a small per-message framing overhead
 * (~4 tokens) so short messages are not undercounted.
 */
export function estimateMessagesTokens(messages: ChatMessage[], model: string): number {
  const OVERHEAD_PER_MESSAGE = 4;
  let total = 0;
  for (const m of messages) {
    total += estimateTokens(m.content, model) + OVERHEAD_PER_MESSAGE;
  }
  return total;
}
