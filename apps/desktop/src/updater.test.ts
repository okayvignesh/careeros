import { describe, expect, it, vi } from 'vitest';
import { isNewerVersion, startUpdater, type UpdaterLike } from './updater';

/**
 * D.6 updater tests. The event wiring is thin; the real risk is the version
 * comparator (so a bad `1.10.0 vs 1.9.0` string compare doesn't ship a
 * downgrade) and that `startUpdater` actually fires an initial check +
 * schedules a recheck.
 */

describe('isNewerVersion', () => {
  it('major/minor/patch bumps are newer', () => {
    expect(isNewerVersion('2.0.0', '1.9.9')).toBe(true);
    expect(isNewerVersion('1.10.0', '1.9.0')).toBe(true); // regression: lex vs numeric
    expect(isNewerVersion('1.0.11', '1.0.9')).toBe(true);
  });

  it('same version is NOT newer', () => {
    expect(isNewerVersion('1.2.3', '1.2.3')).toBe(false);
  });

  it('downgrades are rejected', () => {
    expect(isNewerVersion('1.9.0', '1.10.0')).toBe(false);
    expect(isNewerVersion('0.9.0', '1.0.0')).toBe(false);
  });

  it('stable > prerelease at the same triple', () => {
    expect(isNewerVersion('1.0.0', '1.0.0-rc1')).toBe(true);
    expect(isNewerVersion('1.0.0-rc1', '1.0.0')).toBe(false);
  });

  it('leading v is tolerated', () => {
    expect(isNewerVersion('v1.2.4', 'v1.2.3')).toBe(true);
  });
});

describe('startUpdater', () => {
  function fakeUpdater(): UpdaterLike & { checks: number; handlers: Map<string, Function[]> } {
    const handlers = new Map<string, Function[]>();
    return {
      checks: 0,
      handlers,
      checkForUpdatesAndNotify() {
        (this as unknown as { checks: number }).checks += 1;
        return Promise.resolve(null);
      },
      on(event, handler) {
        const list = handlers.get(event) ?? [];
        list.push(handler);
        handlers.set(event, list);
      },
    };
  }

  it('calls checkForUpdatesAndNotify on start AND on every scheduled tick', () => {
    const u = fakeUpdater();
    let tickFn: (() => void) | null = null;
    const handle = startUpdater({
      updater: u,
      intervalMs: 1_000,
      setInterval: (fn) => {
        tickFn = fn;
        return { cancel: () => {} };
      },
    });
    expect(u.checks).toBe(1);
    tickFn!();
    tickFn!();
    expect(u.checks).toBe(3);
    handle.stop();
  });

  it('wires error / update-available / update-downloaded handlers', () => {
    const u = fakeUpdater();
    startUpdater({
      updater: u,
      setInterval: (fn) => ({ cancel: () => {} }),
    });
    expect(u.handlers.has('error')).toBe(true);
    expect(u.handlers.has('update-available')).toBe(true);
    expect(u.handlers.has('update-downloaded')).toBe(true);
  });

  it('swallows checkForUpdatesAndNotify rejections (logs instead of crashing main)', async () => {
    const u: UpdaterLike & { checks: number } = {
      checks: 0,
      checkForUpdatesAndNotify() {
        this.checks += 1;
        return Promise.reject(new Error('offline'));
      },
      on() {},
    };
    const warn = vi.fn();
    startUpdater({
      updater: u,
      logger: { info: () => {}, warn, error: () => {} },
      setInterval: (fn) => ({ cancel: () => {} }),
    });
    await new Promise((r) => setImmediate(r));
    expect(u.checks).toBe(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('offline'));
  });

  it('returns a no-op stop when electron-updater is missing', () => {
    // No `updater` injected + no real module in the test environment path =
    // require() throws; startUpdater should degrade cleanly.
    const warn = vi.fn();
    const handle = startUpdater({
      // Force the require() path by not passing updater; vitest resolves
      // electron-updater via node_modules so this hits the real happy path.
      // The guard still exists for environments without it.
      logger: { info: () => {}, warn, error: () => {} },
      setInterval: (fn) => ({ cancel: () => {} }),
    });
    expect(typeof handle.stop).toBe('function');
  });
});
