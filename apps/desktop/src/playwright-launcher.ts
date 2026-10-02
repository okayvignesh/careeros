/**
 * J1: Playwright-core launcher that reuses the user's installed Chrome.
 *
 * Design: launchPersistentContext against the user's Chrome channel so cookies
 * and logged-in sessions carry over (that's the whole point of the companion
 * agent). The user-data dir is per-OS; we point at a dedicated subdir under
 * Electron's userData so we don't trample the user's main profile.
 *
 * No new browser download: `playwright-core` plus `channel: 'chrome'` picks
 * up the already-installed Chrome binary on disk. If Chrome is missing the
 * launch rejects; the task-runner surfaces that as a `failed` result.
 *
 * ponytail: profile dir is a single shared "agent-profile" under userData,
 * not a per-task sandbox. Upgrade path when multi-identity (e.g. test account
 * + prod account) matters: namespace by `params.profileId` and plumb the id
 * through from the server.
 *
 * ponytail: using `chromium.launchPersistentContext` with `channel: 'chrome'`
 * reuses the user's installed Chrome binary. Upgrade when we want full
 * profile isolation (incognito-style): swap for `launch({ channel: 'chrome' })`
 * + `newContext()` and set storageState from a per-user disk file.
 */

import { join } from 'node:path';

export interface LaunchedContext {
  // The persistent context exposes a `newPage()` + `close()` surface.
  // We type it structurally to keep this module testable without pulling
  // playwright-core into the test loader.
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
}

export interface PlaywrightPage {
  goto(url: string, opts?: { timeout?: number; waitUntil?: string }): Promise<unknown>;
  fill(selector: string, value: string): Promise<void>;
  setInputFiles(selector: string, files: string | string[]): Promise<void>;
  click(selector: string): Promise<void>;
  waitForSelector(selector: string, opts?: { timeout?: number }): Promise<unknown>;
  screenshot(opts: { path: string; fullPage?: boolean }): Promise<Buffer | void>;
  close(): Promise<void>;
}

export interface LaunchOptions {
  userDataDir: string;
  headless?: boolean;
  /** Injected for tests. In production, left undefined so we require('playwright-core'). */
  launcher?: {
    chromium: {
      launchPersistentContext(
        userDataDir: string,
        opts: { channel?: string; headless?: boolean },
      ): Promise<LaunchedContext>;
    };
  };
}

export function defaultUserDataDir(baseUserData: string): string {
  return join(baseUserData, 'playwright-profile');
}

/**
 * Launch a persistent Chrome context. The caller owns closing it.
 *
 * ponytail: `channel: 'chrome'` picks up the user's installed Chrome. If the
 * user only has Chromium/Edge/Brave, upgrade path is detecting via
 * `which chrome` / registry + mapping to `channel: 'msedge' | 'chrome-beta'`.
 */
export async function launchPersistentChrome(opts: LaunchOptions): Promise<LaunchedContext> {
  const launcher = opts.launcher ?? loadPlaywrightCore();
  return launcher.chromium.launchPersistentContext(opts.userDataDir, {
    channel: 'chrome',
    headless: opts.headless ?? false,
  });
}

function loadPlaywrightCore(): NonNullable<LaunchOptions['launcher']> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pw = require('playwright-core') as NonNullable<LaunchOptions['launcher']>;
  return pw;
}
