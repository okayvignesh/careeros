import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  EmbeddingConfigForm,
  buildEmbeddingPayload,
  type EffectiveEmbeddingConfig,
} from './EmbeddingsPanel';

const noop = () => {};

const storedKeyCfg: EffectiveEmbeddingConfig = {
  mode: 'external',
  model: 'text-embedding-3-small',
  externalBaseUrl: 'https://api.example.com/v1',
  dimensions: 1536,
  hasApiKey: true,
};

const noKeyCfg: EffectiveEmbeddingConfig = { ...storedKeyCfg, hasApiKey: false };

/**
 * Contract test for the new GET shape (`EffectiveEmbeddingConfig`):
 * the API returns `hasApiKey` (never the secret), so the payload must only
 * carry a key the user just typed and must not round-trip a stored one.
 */
describe('buildEmbeddingPayload', () => {
  it('omits externalApiKey when no new key was typed (reuse stored)', () => {
    const payload = buildEmbeddingPayload(storedKeyCfg, '');
    expect(payload).toEqual({
      mode: 'external',
      model: 'text-embedding-3-small',
      externalBaseUrl: 'https://api.example.com/v1',
      dimensions: 1536,
    });
    expect('externalApiKey' in payload).toBe(false);
  });

  it('sends externalApiKey only when a new key is entered', () => {
    const payload = buildEmbeddingPayload(storedKeyCfg, 'sk-new-key');
    expect(payload.externalApiKey).toBe('sk-new-key');
  });

  it('never sends external fields for local mode', () => {
    const payload = buildEmbeddingPayload(
      { ...storedKeyCfg, mode: 'local', hasApiKey: false },
      'sk-should-be-ignored',
    );
    expect(payload).toEqual({ mode: 'local', model: 'text-embedding-3-small' });
  });
});

describe('EmbeddingConfigForm', () => {
  it('reflects a stored key without rendering the secret', () => {
    const html = renderToStaticMarkup(
      createElement(EmbeddingConfigForm, {
        cfg: storedKeyCfg,
        newApiKey: '',
        savedNote: null,
        busy: false,
        onCfgChange: noop,
        onNewApiKeyChange: noop,
        onSubmit: noop,
      }),
    );
    expect(html).toContain('data-testid="embeddings-key-stored"');
    expect(html).toContain('Key stored');
    expect(html).not.toContain('data-testid="embeddings-key-missing"');
    // The key input is empty and invites the user to leave the stored key alone.
    expect(html).toContain('data-testid="embeddings-api-key"');
    expect(html).toContain('value=""');
    expect(html).toContain('Leave blank to keep the stored key');
  });

  it('shows "no key stored" before one exists', () => {
    const html = renderToStaticMarkup(
      createElement(EmbeddingConfigForm, {
        cfg: noKeyCfg,
        newApiKey: '',
        savedNote: null,
        busy: false,
        onCfgChange: noop,
        onNewApiKeyChange: noop,
        onSubmit: noop,
      }),
    );
    expect(html).toContain('data-testid="embeddings-key-missing"');
    expect(html).not.toContain('data-testid="embeddings-key-stored"');
  });

  it('exposes the dimensions field for external mode and echoes the saved value', () => {
    const html = renderToStaticMarkup(
      createElement(EmbeddingConfigForm, {
        cfg: storedKeyCfg,
        newApiKey: '',
        savedNote: null,
        busy: false,
        onCfgChange: noop,
        onNewApiKeyChange: noop,
        onSubmit: noop,
      }),
    );
    expect(html).toContain('data-testid="embeddings-dimensions"');
    expect(html).toContain('value="1536"');
  });

  it('hides external-only fields in local mode', () => {
    const html = renderToStaticMarkup(
      createElement(EmbeddingConfigForm, {
        cfg: { mode: 'local', model: 'bge-small-en', hasApiKey: false },
        newApiKey: '',
        savedNote: null,
        busy: false,
        onCfgChange: noop,
        onNewApiKeyChange: noop,
        onSubmit: noop,
      }),
    );
    expect(html).not.toContain('data-testid="embeddings-api-key"');
    expect(html).not.toContain('data-testid="embeddings-dimensions"');
  });
});
