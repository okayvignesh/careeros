import { describe, expect, it } from 'vitest';
import { reconnectDelayMs } from './wss-client';

/**
 * D.4 scaffold test: cover the reconnect-backoff math. The WssClient itself
 * requires socket.io-client + a running server to exercise end-to-end;
 * backoff is the only non-trivial piece worth guarding in a unit test. The
 * rest is thin orchestration around socket.io's native reconnect semantics.
 *
 * ponytail: no integration test for the WSS client today. Upgrade path:
 * add a Playwright-electron suite under apps/desktop/e2e/ when packaging
 * (D.6) lands; that stream owns the harness.
 */

describe('reconnectDelayMs', () => {
  it('starts at the base delay for attempt 0', () => {
    expect(reconnectDelayMs(0)).toBe(500);
  });

  it('doubles each attempt until the cap', () => {
    expect(reconnectDelayMs(1)).toBe(1_000);
    expect(reconnectDelayMs(2)).toBe(2_000);
    expect(reconnectDelayMs(3)).toBe(4_000);
    expect(reconnectDelayMs(4)).toBe(8_000);
    expect(reconnectDelayMs(5)).toBe(16_000);
    expect(reconnectDelayMs(6)).toBe(32_000);
  });

  it('caps at 60s regardless of attempt', () => {
    expect(reconnectDelayMs(7)).toBe(60_000);
    expect(reconnectDelayMs(10)).toBe(60_000);
    expect(reconnectDelayMs(100)).toBe(60_000);
  });

  it('respects custom base + max params', () => {
    expect(reconnectDelayMs(0, 100, 5_000)).toBe(100);
    expect(reconnectDelayMs(3, 100, 5_000)).toBe(800);
    expect(reconnectDelayMs(10, 100, 5_000)).toBe(5_000);
  });

  it('treats negative attempts as base (defensive)', () => {
    expect(reconnectDelayMs(-1)).toBe(500);
    expect(reconnectDelayMs(-10, 200)).toBe(200);
  });
});
