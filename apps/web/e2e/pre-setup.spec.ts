import { test, expect } from '@playwright/test';

test.describe('pre-setup: unauthenticated smoke', () => {
  test('root renders without 5xx or console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    const res = await page.goto('/', { waitUntil: 'networkidle' });
    expect(res?.status(), 'root should not 5xx').toBeLessThan(500);
    // Root may be the marketing page, the setup wizard, or the dashboard depending on
    // DB state and auth cookies. We just care that it renders and doesn't throw.
    await expect(page.locator('body')).toBeVisible();
    // Filter out third-party dev noise (favicon 404 from Next.js dev) so a real error stands out.
    const meaningful = errors.filter((e) => !/favicon|net::ERR_ABORTED/.test(e));
    expect(meaningful, 'no client console errors on landing').toEqual([]);
  });

  test('setup preflight screen renders', async ({ page }) => {
    await page.goto('/setup/01-preflight', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});
