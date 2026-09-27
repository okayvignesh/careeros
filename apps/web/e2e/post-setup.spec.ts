import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Post-setup smoke. Requires a signed-in storage state via E2E_STORAGE_STATE.
 * Without it these tests skip themselves so CI can still go green while we design
 * the full-wizard stub.
 */
test.describe('post-setup: authenticated smoke', () => {
  test.skip(!process.env.E2E_STORAGE_STATE, 'set E2E_STORAGE_STATE to run (see e2e/README.md)');

  test('dashboard renders headline widgets', async ({ page }) => {
    await page.goto('/dashboard');
    // The heading anchors the widget shell.
    await expect(page.getByRole('heading', { name: /evidence graph/i })).toBeVisible();
    // Contribution heatmap + KPI row + Level header sections should all be present.
    await expect(page.getByText(/GitHub activity/i)).toBeVisible();
    await expect(page.getByText(/Skills tracked/i)).toBeVisible();
    await expect(page.getByText(/Streak/i)).toBeVisible();
  });

  test('skills page groups seeded skills by cluster', async ({ page }) => {
    await page.goto('/skills');
    await expect(page.getByRole('heading', { name: /skill graph/i })).toBeVisible();
    await expect(page.getByText(/language/i).first()).toBeVisible();
  });

  test('evidence explorer renders filters', async ({ page }) => {
    await page.goto('/evidence');
    await expect(page.getByRole('heading', { name: /evidence explorer/i })).toBeVisible();
    await expect(page.getByText(/All time/i)).toBeVisible();
  });

  test('facts page renders header and content', async ({ page }) => {
    await page.goto('/facts');
    await expect(page.getByRole('heading', { name: /verified facts/i })).toBeVisible();
  });

  test('dashboard passes basic axe a11y checks', async ({ page }) => {
    await page.goto('/dashboard');
    const results = await new AxeBuilder({ page })
      .disableRules(['color-contrast']) // dark theme; contrast tuned by design skill
      .analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });

  for (const path of [
    '/skills',
    '/evidence',
    '/facts',
    '/arena',
    '/arena/progression',
    '/settings/providers',
    '/settings/embeddings',
    '/settings/integrations',
    '/settings/workers',
    '/settings/usage',
  ]) {
    test(`${path} passes basic axe a11y checks`, async ({ page }) => {
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .disableRules(['color-contrast'])
        .analyze();
      expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
    });
  }
});
