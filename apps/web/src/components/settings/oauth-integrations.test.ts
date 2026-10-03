import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  beginOAuth,
  gmailWatchFromRow,
  oauthStartPath,
  parseConnectedParam,
  type IntegrationRow,
} from './oauth-integrations';
import { GmailCard, SlackCard } from './IntegrationsPanel';

const noopAsync = async () => {};

describe('oauthStartPath', () => {
  it('points at the auth-required start endpoints', () => {
    expect(oauthStartPath('slack')).toBe('/webhooks/slack/oauth/start');
    expect(oauthStartPath('gmail')).toBe('/integrations/gmail/oauth/start');
  });
});

describe('beginOAuth', () => {
  it('loads the provider authorize URL then navigates to it', async () => {
    const loadUrl = vi.fn().mockResolvedValue({ url: 'https://slack.com/oauth/v2/authorize?x=1' });
    const navigate = vi.fn();
    await beginOAuth('slack', { loadUrl, navigate });
    expect(loadUrl).toHaveBeenCalledWith('/webhooks/slack/oauth/start');
    expect(navigate).toHaveBeenCalledWith('https://slack.com/oauth/v2/authorize?x=1');
  });

  it('propagates an unconfigured-API error and does not navigate', async () => {
    const loadUrl = vi
      .fn()
      .mockRejectedValue(new Error('Gmail integration is not configured. Set GMAIL_OAUTH_CLIENT_ID.'));
    const navigate = vi.fn();
    await expect(beginOAuth('gmail', { loadUrl, navigate })).rejects.toThrow(
      'Gmail integration is not configured',
    );
    expect(loadUrl).toHaveBeenCalledWith('/integrations/gmail/oauth/start');
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('parseConnectedParam', () => {
  it('accepts only the two known kinds', () => {
    expect(parseConnectedParam('slack')).toBe('slack');
    expect(parseConnectedParam('gmail')).toBe('gmail');
    expect(parseConnectedParam('github')).toBeNull();
    expect(parseConnectedParam('')).toBeNull();
    expect(parseConnectedParam(null)).toBeNull();
  });
});

describe('gmailWatchFromRow', () => {
  it('is null for a missing or disconnected row', () => {
    expect(gmailWatchFromRow(null)).toBeNull();
    expect(
      gmailWatchFromRow({
        kind: 'gmail',
        status: 'revoked',
        connectedAt: new Date(0).toISOString(),
        metadata: { historyId: '7' },
      }),
    ).toBeNull();
  });

  it('is null when the row has no watch metadata (today)', () => {
    expect(
      gmailWatchFromRow({
        kind: 'gmail',
        status: 'connected',
        connectedAt: new Date(0).toISOString(),
        metadata: {},
      }),
    ).toBeNull();
  });

  it('reads a watch iff the API exposes it', () => {
    expect(
      gmailWatchFromRow({
        kind: 'gmail',
        status: 'connected',
        connectedAt: new Date(0).toISOString(),
        metadata: { historyId: '123', expiration: '2026-01-01T00:00:00.000Z' },
      }),
    ).toEqual({ historyId: '123', expiration: '2026-01-01T00:00:00.000Z' });
  });
});

describe('SlackCard', () => {
  it('offers install, names least-privilege scopes, and fakes no connected state', () => {
    const html = renderToStaticMarkup(createElement(SlackCard, { returned: false }));
    expect(html).toContain('data-testid="slack-card"');
    expect(html).toContain('data-testid="slack-connect"');
    expect(html).toContain('Install to Slack');
    expect(html).toContain('chat:write');
    expect(html).toContain('commands');
    expect(html).toContain('im:history');
    expect(html).toContain('not exposed by the API');
    expect(html).not.toContain('>Connected<');
    expect(html).not.toContain('Disconnect');
  });
});

describe('GmailCard', () => {
  it('renders a disconnected card with connect and no fake metadata', () => {
    const html = renderToStaticMarkup(
      createElement(GmailCard, { row: null, returned: false, onChanged: noopAsync }),
    );
    expect(html).toContain('data-testid="gmail-card"');
    expect(html).toContain('data-testid="gmail-connect"');
    expect(html).toContain('Not connected');
    expect(html).toContain('gmail.readonly');
    expect(html).not.toContain('data-testid="gmail-disconnect"');
  });

  it('shows connected + disconnect, without inventing watch fields', () => {
    const row: IntegrationRow = {
      kind: 'gmail',
      status: 'connected',
      connectedAt: new Date(0).toISOString(),
      metadata: {},
    };
    const html = renderToStaticMarkup(
      createElement(GmailCard, { row, returned: true, onChanged: noopAsync }),
    );
    expect(html).toContain('connected');
    expect(html).toContain('data-testid="gmail-disconnect"');
    expect(html).not.toContain('historyId');
  });

  it('renders historyId/expiration only when the API exposes them', () => {
    const row: IntegrationRow = {
      kind: 'gmail',
      status: 'connected',
      connectedAt: new Date(0).toISOString(),
      metadata: { historyId: '998877', expiration: '2026-02-01T00:00:00.000Z' },
    };
    const html = renderToStaticMarkup(
      createElement(GmailCard, { row, returned: false, onChanged: noopAsync }),
    );
    expect(html).toContain('historyId');
    expect(html).toContain('998877');
    expect(html).toContain('watch expires');
  });
});
