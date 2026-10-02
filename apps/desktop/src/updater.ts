/**
 * D.6 updater wire. Checks GitHub Releases on app start (and on a 6h tick),
 * downloads any newer version in the background, and prompts the user to
 * restart to apply.
 *
 * `autoUpdater.checkForUpdatesAndNotify()` is the one-call API that does
 * check + download + native OS notification. The event handlers below exist
 * so (a) failures are logged instead of swallowed and (b) tests can lock the
 * version-comparison rule without spinning up a real feed URL.
 *
 * ponytail: unsigned MVP. Mac notarization needs APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD
 * + APPLE_TEAM_ID in the release workflow + a notarize hook; Windows EV cert
 * needs CSC_LINK + CSC_KEY_PASSWORD. Phase-3.5 non-goal; see docs/install.md
 * Gatekeeper/SmartScreen workaround until certs land.
 *
 * ponytail: 6h recheck is a fixed interval, not an exponential backoff on
 * network errors. Upgrade when a user complains that offline laptops are
 * hammering their logs.
 */

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

export interface UpdaterLike {
  checkForUpdatesAndNotify(): Promise<unknown>;
  on(event: string, handler: (...args: unknown[]) => void): void;
}

export interface UpdaterOptions {
  updater?: UpdaterLike;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
  intervalMs?: number;
  // Injected so the test can tick the schedule without `vi.useFakeTimers`
  // crossing module boundaries. Returns a cancel handle.
  setInterval?: (fn: () => void, ms: number) => { cancel: () => void };
}

/**
 * Pure comparator for "is `candidate` strictly newer than `current`?".
 * Honors SemVer major.minor.patch; prerelease tags are compared lexically
 * after the triple (so `1.0.0` > `1.0.0-rc1`, matching electron-updater).
 * Exported so the test can lock the rule without the updater runtime.
 */
export function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (v: string): [number, number, number, string] => {
    const [core, pre = '~'] = v.replace(/^v/, '').split('-', 2);
    const [maj = '0', min = '0', pat = '0'] = core.split('.');
    return [Number(maj) || 0, Number(min) || 0, Number(pat) || 0, pre];
  };
  const [a1, a2, a3, aPre] = parse(candidate);
  const [b1, b2, b3, bPre] = parse(current);
  if (a1 !== b1) return a1 > b1;
  if (a2 !== b2) return a2 > b2;
  if (a3 !== b3) return a3 > b3;
  // '~' sorts after any real prerelease label, giving stable > prerelease.
  return aPre > bPre;
}

export function startUpdater(opts: UpdaterOptions = {}): { stop: () => void } {
  const log = opts.logger ?? console;
  const intervalMs = opts.intervalMs ?? SIX_HOURS_MS;

  // Lazy-require so unit tests (which never load electron-updater) stay fast
  // and work without the native dep installed.
  let updater: UpdaterLike;
  if (opts.updater) {
    updater = opts.updater;
  } else {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('electron-updater') as { autoUpdater: UpdaterLike };
      updater = mod.autoUpdater;
    } catch (err) {
      log.warn(`updater: electron-updater not available (${(err as Error).message}); updates disabled`);
      return { stop: () => {} };
    }
  }

  updater.on('error', (err: unknown) => {
    log.warn(`updater: ${(err as Error).message ?? String(err)}`);
  });
  updater.on('update-available', (info: unknown) => {
    const version = (info as { version?: string } | undefined)?.version ?? 'unknown';
    log.info(`updater: update-available v${version}`);
  });
  updater.on('update-downloaded', (info: unknown) => {
    const version = (info as { version?: string } | undefined)?.version ?? 'unknown';
    log.info(`updater: update-downloaded v${version}; user will be prompted to restart`);
  });

  const check = (): void => {
    updater.checkForUpdatesAndNotify().catch((err: Error) => {
      log.warn(`updater: check failed (${err.message})`);
    });
  };

  check();

  let handle: { cancel: () => void };
  if (opts.setInterval) {
    handle = opts.setInterval(check, intervalMs);
  } else {
    const t = setInterval(check, intervalMs);
    if (typeof (t as unknown as { unref?: () => void }).unref === 'function') {
      (t as unknown as { unref: () => void }).unref();
    }
    handle = { cancel: () => clearInterval(t) };
  }
  return { stop: () => handle.cancel() };
}
