import type { AIProvider } from '../provider';
import type { ProviderRegistry } from '../registry';
import { DeepSeekProvider } from './deepseek';
import {
  OPENAI_COMPATIBLE_DEFAULT_CAPABILITIES,
  OpenAICompatibleProvider,
  defaultBaseUrlFor,
  type LlmCallHook,
} from './openai-compatible';
import { OllamaProvider } from './ollama';

/**
 * One construction spec every adapter accepts. `provider` is the
 * `ProviderConfig.provider` value; unknown/unsupported ids throw so the loader
 * can treat them as an unavailable candidate instead of constructing garbage.
 */
export interface ProviderBuildSpec {
  provider: string;
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
  chatModel: string;
  onCall?: LlmCallHook | undefined;
  allowlist?: string[] | undefined;
  maxTokens?: number | undefined;
  contextWindow?: number | undefined;
}

/** Build the adapter for a configured provider id. */
export function createProvider(spec: ProviderBuildSpec): AIProvider {
  switch (spec.provider) {
    case 'deepseek':
      if (!spec.apiKey) throw new Error('provider "deepseek" requires an API key');
      return new DeepSeekProvider({
        apiKey: spec.apiKey,
        chatModel: spec.chatModel,
        ...(spec.baseUrl ? { baseUrl: spec.baseUrl } : {}),
        ...(spec.onCall ? { onCall: spec.onCall } : {}),
        ...(spec.allowlist ? { allowlist: spec.allowlist } : {}),
        ...(spec.maxTokens != null ? { maxTokens: spec.maxTokens } : {}),
      });
    case 'ollama':
      return new OllamaProvider({
        chatModel: spec.chatModel,
        ...(spec.baseUrl ? { baseUrl: spec.baseUrl } : {}),
        ...(spec.onCall ? { onCall: spec.onCall } : {}),
        ...(spec.allowlist ? { allowlist: spec.allowlist } : {}),
        ...(spec.maxTokens != null ? { maxTokens: spec.maxTokens } : {}),
        ...(spec.contextWindow != null ? { contextWindow: spec.contextWindow } : {}),
      });
    case 'openai':
    case 'openrouter':
    case 'custom': {
      const baseUrl = spec.baseUrl ?? defaultBaseUrlFor(spec.provider);
      if (!baseUrl) throw new Error(`provider "${spec.provider}" requires a baseUrl`);
      if (spec.provider !== 'custom' && !spec.apiKey) {
        throw new Error(`provider "${spec.provider}" requires an API key`);
      }
      return new OpenAICompatibleProvider({
        name: spec.provider,
        baseUrl,
        chatModel: spec.chatModel,
        capabilities:
          spec.contextWindow != null
            ? { ...OPENAI_COMPATIBLE_DEFAULT_CAPABILITIES, contextWindow: spec.contextWindow }
            : OPENAI_COMPATIBLE_DEFAULT_CAPABILITIES,
        ...(spec.apiKey ? { apiKey: spec.apiKey } : {}),
        ...(spec.onCall ? { onCall: spec.onCall } : {}),
        ...(spec.allowlist ? { allowlist: spec.allowlist } : {}),
        ...(spec.maxTokens != null ? { maxTokens: spec.maxTokens } : {}),
      });
    }
    default:
      throw new Error(`Unsupported provider "${spec.provider}"`);
  }
}

/**
 * Register the built-in adapters in a `ProviderRegistry` for capability
 * listing / the setup wizard. Idempotent. Factories hold placeholder
 * credentials because the registry is metadata-only; real per-user clients are
 * built by `createProvider` in the provider loader.
 */
export function registerBuiltinProviders(registry: ProviderRegistry): void {
  const builtins: Array<[string, () => AIProvider]> = [
    ['deepseek', () => new DeepSeekProvider({ apiKey: '', chatModel: 'deepseek-chat' })],
    [
      'openai',
      () =>
        new OpenAICompatibleProvider({
          name: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          chatModel: 'gpt-4o-mini',
        }),
    ],
    [
      'openrouter',
      () =>
        new OpenAICompatibleProvider({
          name: 'openrouter',
          baseUrl: 'https://openrouter.ai/api/v1',
          chatModel: 'openai/gpt-4o-mini',
        }),
    ],
    ['ollama', () => new OllamaProvider({ chatModel: 'llama3.1' })],
  ];
  for (const [name, factory] of builtins) {
    if (!registry.has(name)) registry.register(name, factory);
  }
}
