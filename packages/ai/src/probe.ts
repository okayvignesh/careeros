import type { DeepSeekProvider } from './providers/deepseek';

export interface ProbeResult {
  chat: { ok: boolean; latencyMs: number; error?: string };
  structured: { ok: boolean; latencyMs: number; error?: string };
  tools: { ok: boolean; latencyMs: number; error?: string };
  streaming: { ok: boolean; latencyMs: number; error?: string };
}

const TIMEOUT_MS = 15_000;

/**
 * Runs 4 real calls against the provider: chat, JSON output, tool use, streaming.
 * Returns per-capability {ok, latencyMs, error?}. Never throws.
 */
export async function probeProvider(provider: DeepSeekProvider): Promise<ProbeResult> {
  const [chat, structured, tools, streaming] = await Promise.all([
    time(() => provider.testChat()),
    time(() => provider.testStructured()),
    time(() => provider.testTools()),
    time(() => provider.testStreaming()),
  ]);
  return { chat, structured, tools, streaming };
}

async function time(fn: () => Promise<unknown>): Promise<{
  ok: boolean;
  latencyMs: number;
  error?: string;
}> {
  const t = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), TIMEOUT_MS);
  try {
    await fn();
    return { ok: true, latencyMs: Date.now() - t };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t, error: (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}
