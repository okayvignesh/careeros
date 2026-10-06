import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SessionList } from './SecurityPanel';
import type { ActiveSession } from '@/lib/sessions';

/**
 * A-H3 sessions render smoke test. Same createElement + renderToStaticMarkup
 * pattern as DevicesPanel.test.ts (no jsdom): proves the current-session badge
 * is unique to the caller's own row and that only other rows can be revoked.
 */
const current: ActiveSession = {
  id: 's1',
  label: 'Chrome on macOS',
  ipMasked: '203.0.113.x',
  createdAt: new Date(0).toISOString(),
  lastSeenAt: new Date(0).toISOString(),
  expiresAt: new Date(86_400_000).toISOString(),
  current: true,
};

const other: ActiveSession = {
  ...current,
  id: 's2',
  label: 'Firefox on Windows',
  ipMasked: null,
  current: false,
};

const noop = () => {};

describe('SessionList', () => {
  it('renders every session, flags the current one, and masks the IP', () => {
    const html = renderToStaticMarkup(
      createElement(SessionList, { sessions: [current, other], busyId: null, onAskRevoke: noop }),
    );
    expect((html.match(/data-testid="session-row"/g) ?? []).length).toBe(2);
    expect(html).toContain('Chrome on macOS');
    expect(html).toContain('Firefox on Windows');
    expect(html).toContain('203.0.113.x');
    expect(html).toContain('data-testid="session-current"');
    expect(html).toContain('Current session');
    // Exactly one revoke control — the current row has none.
    expect((html.match(/data-testid="session-revoke"/g) ?? []).length).toBe(1);
  });

  it('disables the revoke control while that session is being revoked', () => {
    const html = renderToStaticMarkup(
      createElement(SessionList, { sessions: [other], busyId: 's2', onAskRevoke: noop }),
    );
    expect(html).toContain('data-testid="session-revoke"');
    expect(html).toContain('disabled');
  });
});
