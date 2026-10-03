// Per-1M-token USD price sheets by provider + model. Only providers whose
// pricing is public and stable are listed; anything else returns null so the
// ledger records "unknown" instead of a fabricated number. Ollama is local and
// therefore always 0. Snapshot current at time of writing; update alongside the
// provider docs when rates move.
type PriceRow = { inputPer1M: number; outputPer1M: number };

/**
 * Bumped whenever a rate in `PRICES` changes. Persisted per `llm_calls` row so a
 * historical cost can be re-derived against the sheet that produced it
 * (ai-safety.md item 9).
 */
export const PRICING_VERSION = '2026-10-03';

export interface CostBreakdown {
  costInput: number;
  costOutput: number;
  costTotal: number;
  pricingVersion: string;
}

const PRICES: Record<string, Record<string, PriceRow>> = {
  // https://api-docs.deepseek.com/quick_start/pricing
  deepseek: {
    'deepseek-chat': { inputPer1M: 0.27, outputPer1M: 1.1 },
    'deepseek-reasoner': { inputPer1M: 0.55, outputPer1M: 2.19 },
  },
  // https://openai.com/api/pricing (standard tier)
  openai: {
    'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10 },
    'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
    'gpt-4.1': { inputPer1M: 2, outputPer1M: 8 },
    'gpt-4.1-mini': { inputPer1M: 0.4, outputPer1M: 1.6 },
    'o3-mini': { inputPer1M: 1.1, outputPer1M: 4.4 },
  },
};

export function estimateCostUsd(
  provider: string,
  model: string,
  promptTokens: number,
  completionTokens: number,
): number | null {
  // Local inference has no marginal cost (electricity ignored, matching the
  // ai-safety.md "Ollama (free)" sheet).
  if (provider === 'ollama') return 0;
  const p = PRICES[provider]?.[model];
  if (!p) return null;
  return (promptTokens * p.inputPer1M + completionTokens * p.outputPer1M) / 1_000_000;
}

/**
 * Split cost into its input/output components for the audit ledger. Returns null
 * when the provider/model has no published rate (so the row records "unknown"
 * rather than a fabricated split).
 */
export function estimateCostBreakdown(
  provider: string,
  model: string,
  promptTokens: number,
  completionTokens: number,
): CostBreakdown | null {
  if (provider === 'ollama') {
    return { costInput: 0, costOutput: 0, costTotal: 0, pricingVersion: 'local' };
  }
  const p = PRICES[provider]?.[model];
  if (!p) return null;
  const costInput = (promptTokens * p.inputPer1M) / 1_000_000;
  const costOutput = (completionTokens * p.outputPer1M) / 1_000_000;
  return {
    costInput,
    costOutput,
    costTotal: costInput + costOutput,
    pricingVersion: PRICING_VERSION,
  };
}
