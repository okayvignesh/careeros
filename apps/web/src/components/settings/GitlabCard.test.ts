import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  buildGitlabConnectPayload,
  connectBlockedReason,
  gitlabBaseUrlFromRow,
  gitlabHostFromRow,
  hostFromUrl,
  needsAllowlistOptIn,
  type GitlabConnectFormState,
} from './gitlab-connect';
import { GitlabCard, GitlabConnectForm } from './IntegrationsPanel';

const noop = () => {};

const validPat = 'glpat-abcdefghijklmnopqrst';
const baseForm: GitlabConnectFormState = { pat: validPat, baseUrl: '', allowlistOptIn: false };

function renderForm(overrides: Partial<GitlabConnectFormState> = {}): string {
  return renderToStaticMarkup(
    createElement(GitlabConnectForm, {
      form: { ...baseForm, ...overrides },
      connected: false,
      busy: false,
      onPat: noop,
      onBaseUrl: noop,
      onAllowlist: noop,
      onSubmit: noop,
    }),
  );
}

function buttonTag(html: string, testId: string): string {
  const match = html.match(new RegExp(`<button[^>]*data-testid="${testId}"[^>]*>`));
  expect(match).not.toBeNull();
  return match?.[0] ?? '';
}

describe('needsAllowlistOptIn', () => {
  it('is false for blank input and gitlab.com', () => {
    expect(needsAllowlistOptIn('')).toBe(false);
    expect(needsAllowlistOptIn('https://gitlab.com')).toBe(false);
    expect(needsAllowlistOptIn('https://gitlab.com/group/project')).toBe(false);
  });

  it('is true for any non-gitlab.com host', () => {
    expect(needsAllowlistOptIn('https://gitlab.example.com')).toBe(true);
    expect(needsAllowlistOptIn('http://git.internal:8080')).toBe(true);
  });

  it('is false for unparseable input (the API owns that reject)', () => {
    expect(needsAllowlistOptIn('not a url')).toBe(false);
    expect(hostFromUrl('not a url')).toBeNull();
  });
});

describe('gitlabHostFromRow', () => {
  it('derives the host from the stored profile webUrl', () => {
    expect(
      gitlabHostFromRow({
        kind: 'gitlab',
        status: 'connected',
        connectedAt: new Date(0).toISOString(),
        metadata: { webUrl: 'https://gitlab.com/jane' },
      }),
    ).toBe('gitlab.com');
    expect(
      gitlabHostFromRow({
        kind: 'gitlab',
        status: 'connected',
        connectedAt: new Date(0).toISOString(),
        metadata: { webUrl: 'https://gitlab.acme.dev/jane' },
      }),
    ).toBe('gitlab.acme.dev');
  });

  it('prefers an explicit metadata.baseUrl and returns null otherwise', () => {
    expect(
      gitlabHostFromRow({
        kind: 'gitlab',
        status: 'connected',
        connectedAt: new Date(0).toISOString(),
        metadata: { baseUrl: 'https://git.acme.dev', webUrl: 'https://other.dev/jane' },
      }),
    ).toBe('git.acme.dev');
    // A top-level baseUrl (if the list ever exposes it) wins over metadata.
    expect(
      gitlabHostFromRow({
        kind: 'gitlab',
        status: 'connected',
        connectedAt: new Date(0).toISOString(),
        metadata: { webUrl: 'https://other.dev/jane' },
        baseUrl: 'https://git.top.dev',
      }),
    ).toBe('git.top.dev');
    expect(gitlabHostFromRow(null)).toBeNull();
  });

  it('reconstructs the origin for reauth prefill', () => {
    expect(
      gitlabBaseUrlFromRow({
        kind: 'gitlab',
        status: 'connected',
        connectedAt: new Date(0).toISOString(),
        metadata: { webUrl: 'https://gitlab.acme.dev:8443/jane/profile' },
      }),
    ).toBe('https://gitlab.acme.dev:8443');
    expect(gitlabBaseUrlFromRow(null)).toBeNull();
  });
});

describe('buildGitlabConnectPayload', () => {
  it('sends only the PAT for gitlab.com (no baseUrl / allowlistOptIn)', () => {
    const payload = buildGitlabConnectPayload(baseForm);
    expect(payload).toEqual({ pat: validPat });
    expect('baseUrl' in payload).toBe(false);
    expect('allowlistOptIn' in payload).toBe(false);
  });

  it('includes an explicit gitlab.com baseUrl but never an opt-in', () => {
    const payload = buildGitlabConnectPayload({ ...baseForm, baseUrl: 'https://gitlab.com' });
    expect(payload).toEqual({ pat: validPat, baseUrl: 'https://gitlab.com' });
    expect('allowlistOptIn' in payload).toBe(false);
  });

  it('includes baseUrl + allowlistOptIn:true for a self-hosted host', () => {
    const payload = buildGitlabConnectPayload({
      ...baseForm,
      baseUrl: ' https://gitlab.acme.dev ',
      allowlistOptIn: true,
    });
    expect(payload).toEqual({
      pat: validPat,
      baseUrl: 'https://gitlab.acme.dev',
      allowlistOptIn: true,
    });
  });
});

describe('connectBlockedReason', () => {
  it('blocks a PAT shorter than the API minimum', () => {
    expect(connectBlockedReason({ ...baseForm, pat: 'short' })).toMatch(/at least 20/);
  });

  it('blocks a self-hosted host until the opt-in is ticked, then allows it', () => {
    const form = { ...baseForm, baseUrl: 'https://gitlab.acme.dev' };
    expect(connectBlockedReason(form)).toMatch(/self-hosted confirmation/i);
    expect(connectBlockedReason({ ...form, allowlistOptIn: true })).toBeNull();
  });

  it('allows gitlab.com with a valid PAT', () => {
    expect(connectBlockedReason(baseForm)).toBeNull();
  });
});

describe('GitlabConnectForm', () => {
  it('does not show the opt-in block for gitlab.com', () => {
    const html = renderForm();
    expect(html).toContain('data-testid="gitlab-pat"');
    expect(html).toContain('data-testid="gitlab-base-url"');
    expect(html).not.toContain('data-testid="gitlab-allowlist"');
    expect(buttonTag(html, 'gitlab-connect')).not.toContain('disabled=""');
  });

  it('gates a self-hosted host behind the opt-in with a visible warning', () => {
    const html = renderForm({ baseUrl: 'https://gitlab.acme.dev' });
    expect(html).toContain('data-testid="gitlab-allowlist-block"');
    expect(html).toContain('data-testid="gitlab-allowlist"');
    expect(html).toContain('gitlab.acme.dev');
    expect(html).toContain('data-testid="gitlab-connect-hint"');
    expect(html).toMatch(/self-hosted confirmation/i);
    expect(buttonTag(html, 'gitlab-connect')).toContain('disabled=""');
  });

  it('enables connect once the self-hosted opt-in is ticked', () => {
    const html = renderForm({ baseUrl: 'https://gitlab.acme.dev', allowlistOptIn: true });
    expect(html).not.toContain('data-testid="gitlab-connect-hint"');
    expect(buttonTag(html, 'gitlab-connect')).not.toContain('disabled=""');
  });
});

describe('GitlabCard', () => {
  it('renders a disconnected card with the connect form and no fake status', () => {
    const html = renderToStaticMarkup(
      createElement(GitlabCard, { row: null, onChanged: async () => {} }),
    );
    expect(html).toContain('data-testid="gitlab-card"');
    expect(html).toContain('Not connected');
    expect(html).toContain('data-testid="gitlab-connect-form"');
    expect(html).not.toContain('Connected');
  });
});
