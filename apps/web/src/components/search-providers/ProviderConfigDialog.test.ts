import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SearchProvider } from '@careeros/shared';
import { ProviderConfigDialog, buildProviderPayload } from './ProviderConfigDialog';

const provider: SearchProvider = {
  id: 'adzuna',
  name: 'Adzuna',
  host: 'api.adzuna.com',
  status: 'standby',
  addedAt: null,
  usage: '1 req/s',
  quota: null,
  used: null,
  authNote: 'missing appKey',
  fields: [
    { name: 'appId', label: 'Adzuna app ID', secret: false, required: true },
    { name: 'appKey', label: 'Adzuna app key', secret: true, required: true },
  ],
  values: { appId: 'app-1' },
  has: { appKey: true },
  configured: false,
  missing: ['appKey'],
};

describe('buildProviderPayload', () => {
  it('always sends public values and omits a blank secret (keep stored)', () => {
    expect(buildProviderPayload(provider, { appId: 'app-1', appKey: '' })).toEqual({
      values: { appId: 'app-1' },
    });
  });

  it('sends a secret only when the user typed a new value', () => {
    expect(buildProviderPayload(provider, { appId: 'app-1', appKey: 'new-key' })).toEqual({
      values: { appId: 'app-1', appKey: 'new-key' },
    });
  });

  it('sends an empty public value so the server can clear it', () => {
    expect(buildProviderPayload(provider, { appId: '', appKey: '' })).toEqual({
      values: { appId: '' },
    });
  });
});

describe('ProviderConfigDialog', () => {
  it('renders one labelled control per field with data-testids, secrets marked stored', () => {
    const html = renderToStaticMarkup(
      createElement(ProviderConfigDialog, {
        provider,
        open: true,
        onClose: () => {},
        onSaved: () => {},
      }),
    );
    expect(html).toContain('data-testid="provider-config-adzuna"');
    expect(html).toContain('data-testid="provider-field-adzuna-appId"');
    expect(html).toContain('data-testid="provider-field-adzuna-appKey"');
    expect(html).toContain('data-testid="provider-field-adzuna-appKey-stored"');
    expect(html).toContain('value="app-1"');
    expect(html).toContain('leave blank to keep');
  });
});
