import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for Career OS.
 *
 * Assumes the api + web dev servers are already running (`docker compose up`).
 * The docker stack is our test target so tests exercise real Postgres/Qdrant/Redis
 * rather than mocks. If we ever add ephemeral test containers, wire them in via
 * `webServer` here.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // single-user app; parallel would step on shared state
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Cookies from a manual dev session can be stashed here so post-setup tests
    // don't need to log in every run. See `e2e/README.md`.
    ...(process.env.E2E_STORAGE_STATE ? { storageState: process.env.E2E_STORAGE_STATE } : {}),
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
