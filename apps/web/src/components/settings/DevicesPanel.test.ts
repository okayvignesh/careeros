import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DeviceList, PairingCodeCard } from './DevicesPanel';
import type { AgentDevice } from '@/lib/agent';

/**
 * D.3 render smoke test. Same createElement + renderToStaticMarkup pattern as
 * Sparkline.test.ts (no jsdom): proves the list wires platform/status into the
 * accessible markup and that only active devices get a revoke control.
 */
const active: AgentDevice = {
  id: 'd1',
  name: 'Work MacBook',
  platform: 'darwin',
  pairedAt: new Date(0).toISOString(),
  revokedAt: null,
  lastSeenAt: new Date(60_000).toISOString(),
  agentVersion: '0.1.0',
};

const revoked: AgentDevice = {
  ...active,
  id: 'd2',
  name: 'Old Laptop',
  platform: 'win32',
  revokedAt: new Date(0).toISOString(),
  lastSeenAt: null,
};

const noop = () => {};

describe('DeviceList', () => {
  it('renders platform, status and last-seen for each device', () => {
    const html = renderToStaticMarkup(
      createElement(DeviceList, {
        devices: [active, revoked],
        now: 120_000,
        busyId: null,
        confirmingId: null,
        onAskRevoke: noop,
        onCancelRevoke: noop,
        onConfirmRevoke: noop,
      }),
    );
    expect(html).toContain('Work MacBook');
    expect(html).toContain('macOS');
    expect(html).toContain('Active');
    expect(html).toContain('Windows');
    expect(html).toContain('Revoked');
    expect(html).toContain('Last seen 1m ago');
    expect((html.match(/data-testid="device-row"/g) ?? []).length).toBe(2);
    // Exactly one revoke control — the revoked row has none.
    expect((html.match(/data-testid="device-revoke"/g) ?? []).length).toBe(1);
  });

  it('swaps in an inline confirm when a revoke is pending', () => {
    const html = renderToStaticMarkup(
      createElement(DeviceList, {
        devices: [active],
        now: 0,
        busyId: null,
        confirmingId: 'd1',
        onAskRevoke: noop,
        onCancelRevoke: noop,
        onConfirmRevoke: noop,
      }),
    );
    expect(html).toContain('data-testid="device-revoke-confirm"');
    expect(html).toContain('data-testid="device-revoke-cancel"');
    expect(html).toContain('Revoke this device?');
    expect(html).not.toContain('data-testid="device-revoke"');
  });
});

describe('PairingCodeCard', () => {
  it('announces the 6-digit code to assistive tech', () => {
    const html = renderToStaticMarkup(
      createElement(PairingCodeCard, {
        pairing: {
          code: '042917',
          pairingRequestId: 'p',
          expiresAt: new Date(0).toISOString(),
        },
        onDismiss: noop,
      }),
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('data-testid="pairing-code"');
    expect(html).toContain('042917');
  });
});
