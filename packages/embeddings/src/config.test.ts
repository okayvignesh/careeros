// Resolver tests: the single place that turns the saved `app_config` payload
// (or the env fallback) into a provider + collection dimension. External mode
// without a usable config must throw, never degrade to deterministic.
import { describe, expect, it, vi } from 'vitest';
import {
  createProviderFromResolved,
  loadResolvedEmbeddingConfig,
  resolveEmbeddingConfig,
  EmbeddingConfigError,
} from './config';
import { EMBED_DIM } from './local';

const validExternal = {
  mode: 'external' as const,
  model: 'text-embedding-3-small',
  externalBaseUrl: 'https://api.example.com/v1',
  externalApiKey: 'sk-live',
  dimensions: 1536,
};

describe('resolveEmbeddingConfig', () => {
  it('resolves an external config with its declared dimension', () => {
    const r = resolveEmbeddingConfig(validExternal);
    expect(r.mode).toBe('external');
    expect(r.dim).toBe(1536);
    expect(r.hasApiKey).toBe(true);
    expect(r.source).toBe('app_config');
    expect(r.external).toMatchObject({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-live',
      model: 'text-embedding-3-small',
      dimensions: 1536,
    });
  });

  it('decrypts the stored API key through the injected reader', () => {
    const decryptApiKey = vi.fn(() => 'sk-decrypted');
    const r = resolveEmbeddingConfig(
      { ...validExternal, externalApiKey: 'enc:v1:embedding.externalApiKey:abc' },
      { decryptApiKey },
    );
    expect(decryptApiKey).toHaveBeenCalledWith('enc:v1:embedding.externalApiKey:abc');
    expect(r.external?.apiKey).toBe('sk-decrypted');
  });

  it('throws external without a saved config instead of degrading to deterministic', () => {
    expect(() => resolveEmbeddingConfig(null, { envMode: 'external' })).toThrow(
      EmbeddingConfigError,
    );
    expect(() => resolveEmbeddingConfig(null, { envMode: 'external' })).toThrow(
      /no embedding config is saved/i,
    );
  });

  it('falls back to EMBEDDING_MODE when no config row exists', () => {
    const r = resolveEmbeddingConfig(null, { envMode: 'deterministic' });
    expect(r.mode).toBe('deterministic');
    expect(r.dim).toBe(EMBED_DIM);
    expect(r.source).toBe('env');
    expect(r.hasApiKey).toBe(false);
  });

  it('defaults to local when neither config nor env mode is set', () => {
    const r = resolveEmbeddingConfig(null, {});
    expect(r.mode).toBe('local');
    expect(r.dim).toBe(EMBED_DIM);
  });

  it('throws when an external config omits dimensions', () => {
    const { dimensions: _drop, ...noDims } = validExternal;
    void _drop;
    expect(() => resolveEmbeddingConfig(noDims)).toThrow(/dimensions/);
  });

  it('throws when an external config omits the key', () => {
    const { externalApiKey: _drop, ...noKey } = validExternal;
    void _drop;
    expect(() => resolveEmbeddingConfig(noKey)).toThrow(/externalApiKey/);
  });
});

describe('loadResolvedEmbeddingConfig', () => {
  it('reads the app_config row and resolves it', async () => {
    const repo = {
      appConfig: { findUnique: async () => ({ value: validExternal }) },
    };
    const r = await loadResolvedEmbeddingConfig(repo);
    expect(r.mode).toBe('external');
    expect(r.dim).toBe(1536);
  });

  it('falls back to env when the row is missing', async () => {
    const repo = { appConfig: { findUnique: async () => null } };
    const r = await loadResolvedEmbeddingConfig(repo, { envMode: 'deterministic' });
    expect(r.mode).toBe('deterministic');
  });
});

describe('createProviderFromResolved', () => {
  it('builds a deterministic provider at EMBED_DIM for local/deterministic configs', () => {
    const r = resolveEmbeddingConfig({ mode: 'deterministic' });
    const provider = createProviderFromResolved(r);
    expect(provider.mode).toBe('deterministic');
    expect(provider.dim).toBe(EMBED_DIM);
  });

  it('builds the external adapter with the declared dimension', () => {
    const r = resolveEmbeddingConfig(validExternal);
    const provider = createProviderFromResolved(r);
    expect(provider.mode).toBe('external');
    expect(provider.dim).toBe(1536);
  });
});
