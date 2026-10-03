// Adapter barrel. Import from './providers' or the package root; never deep
// import a single adapter file from app code.
export { DeepSeekProvider } from './deepseek';
export {
  OPENAI_COMPATIBLE_DEFAULT_CAPABILITIES,
  OpenAICompatibleProvider,
  defaultBaseUrlFor,
  type LlmCallHook,
  type LlmCallRecord,
  type OpenAICompatibleConfig,
  type OpenAIResponse,
} from './openai-compatible';
export { OllamaProvider, type OllamaConfig } from './ollama';
export {
  CircuitBreaker,
  FallbackProvider,
  type CircuitBreakerOptions,
  type FallbackInfo,
  type FallbackProviderOptions,
} from './fallback';
export {
  createProvider,
  registerBuiltinProviders,
  type ProviderBuildSpec,
} from './create';
export {
  isSchemaParseFailure,
  parseStructured,
  schemaErrorMessage,
  structuredFailure,
  structuredRetryMessages,
} from './structured';
export { zodToJsonSchemaObject } from './json-schema';
export { providerFetch, type ProviderFetchOptions } from './fetch';
