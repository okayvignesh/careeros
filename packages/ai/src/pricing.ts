// DeepSeek public pricing (USD per 1M tokens). Cache-hit not modelled yet.
// Source: https://api-docs.deepseek.com/quick_start/pricing (Nov 2025 rates).
const DEEPSEEK_PRICES: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  'deepseek-chat': { inputPer1M: 0.27, outputPer1M: 1.1 },
  'deepseek-reasoner': { inputPer1M: 0.55, outputPer1M: 2.19 },
};

export function estimateCostUsd(
  provider: string,
  model: string,
  promptTokens: number,
  completionTokens: number,
): number | null {
  if (provider !== 'deepseek') return null;
  const p = DEEPSEEK_PRICES[model];
  if (!p) return null;
  return (promptTokens * p.inputPer1M + completionTokens * p.outputPer1M) / 1_000_000;
}
