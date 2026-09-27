// Playwright storage-state helper. Called once in Playwright globalSetup;
// signs in against the running API, then writes cookies+localStorage to
// disk so per-test workers reuse the session (E2E maintainability rule #4
// in plan/testing.md §6).
//
// Usage in apps/web/playwright.config.ts:
//   globalSetup: require.resolve('./e2e/global-setup.ts'),
//   use: { storageState: 'e2e/.auth/storageState.json' }
//
// global-setup.ts:
//   import { seedStorageState } from '@careeros/testing';
//   export default async () => {
//     await seedStorageState({
//       baseUrl: process.env.WEB_URL ?? 'http://localhost:3000',
//       email: 'test@careeros.local',
//       password: 'test-password-123',
//       outFile: 'e2e/.auth/storageState.json',
//     });
//   };
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { chromium } from '@playwright/test';

export interface StorageStateOptions {
  baseUrl: string;
  email: string;
  password: string;
  outFile: string;
  /** Path relative to baseUrl. Defaults to /sign-in. */
  signInPath?: string;
  /**
   * Selector or role for the email input, password input, and submit button.
   * ponytail: defaults match the current sign-in screen; override when the
   * form changes rather than reshaping this helper.
   */
  selectors?: {
    email?: string;
    password?: string;
    submit?: string;
    ready?: string;
  };
}

export async function seedStorageState(opts: StorageStateOptions): Promise<void> {
  const sel = {
    email: opts.selectors?.email ?? 'input[type="email"]',
    password: opts.selectors?.password ?? 'input[type="password"]',
    submit: opts.selectors?.submit ?? 'button[type="submit"]',
    ready: opts.selectors?.ready ?? '[data-testid="app-nav"]',
  };

  await mkdir(dirname(opts.outFile), { recursive: true });

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${opts.baseUrl}${opts.signInPath ?? '/sign-in'}`);
    await page.locator(sel.email).fill(opts.email);
    await page.locator(sel.password).fill(opts.password);
    await Promise.all([
      page.waitForURL((url) => !url.pathname.includes('sign-in')),
      page.locator(sel.submit).click(),
    ]);
    await page.locator(sel.ready).waitFor({ state: 'visible' });
    await context.storageState({ path: opts.outFile });
  } finally {
    await browser.close();
  }
}
