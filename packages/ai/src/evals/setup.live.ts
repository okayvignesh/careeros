// C-P0.5c: live-eval provider wiring. The eval suites resolve a provider from
// `globalThis.__careerosProviderRegistry` (see skill-extract.eval.ts); nothing
// populates that in a standalone vitest run. This setup file does, but only
// when EVAL_LIVE=1 AND a real provider key is present. It also drops a marker
// file so global-setup.ts can label the run `live` vs `mock` without claiming a
// real result for a stubbed run.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createProvider } from '../providers/create';
import { ProviderRegistry } from '../registry';

const outDir = resolve(process.env.EVAL_OUT_DIR ?? 'eval-results');
const key = process.env.DEEPSEEK_API_KEY;

if (process.env.EVAL_LIVE === '1' && key) {
  try {
    const registry = new ProviderRegistry();
    registry.register('deepseek', () =>
      createProvider({
        provider: 'deepseek',
        apiKey: key,
        chatModel: process.env.EVAL_CHAT_MODEL ?? 'deepseek-chat',
      }),
    );
    (globalThis as { __careerosProviderRegistry?: ProviderRegistry }).__careerosProviderRegistry =
      registry;
    mkdirSync(outDir, { recursive: true });
    writeFileSync(`${outDir}/.live-registered`, new Date().toISOString());
  } catch (err) {
    console.warn('live eval provider registration failed; suites will fall back to mock:', err);
  }
} else if (process.env.EVAL_LIVE === '1') {
  console.warn('EVAL_LIVE=1 but DEEPSEEK_API_KEY is unset; suites will run in mock mode.');
}
