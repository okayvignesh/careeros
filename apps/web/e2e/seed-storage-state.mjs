// CI-only setup step: sign in the deterministic seed user and write a Playwright
// storage state so post-setup.spec.ts can run authenticated.
//
// Why not the packages/testing `seedStorageState` helper? It drives the
// /sign-in form, but once setup is complete the web middleware 307s /sign-in to
// /dashboard, so the form is unreachable. Signing in against the API directly
// sets the HttpOnly session cookie on the shared browser context instead.
//
// Run with `node apps/web/e2e/seed-storage-state.mjs` from the repo root after
// `pnpm seed:test`. The api must be reachable at API_URL.
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
const email = process.env.E2E_EMAIL ?? 'test@career-os.local';
const password = process.env.E2E_PASSWORD ?? 'test-password-12345';
const outFile = process.env.E2E_STORAGE_STATE_OUT
  ? resolve(process.cwd(), process.env.E2E_STORAGE_STATE_OUT)
  : resolve(here, '.auth/storageState.json');

await mkdir(dirname(outFile), { recursive: true });

const browser = await chromium.launch();
try {
  const context = await browser.newContext();
  const res = await context.request.post(`${apiUrl}/auth/sign-in`, {
    data: { email, password },
  });
  if (!res.ok()) {
    throw new Error(`e2e sign-in failed (${res.status()}): ${await res.text()}`);
  }
  await context.storageState({ path: outFile });
  console.log(`wrote storage state for ${email} -> ${outFile}`);
} finally {
  await browser.close();
}
