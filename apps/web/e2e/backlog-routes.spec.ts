import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * WS1 backlog: navigation wiring + the new authenticated screens.
 *
 * Requires a signed-in storage state via E2E_STORAGE_STATE (see e2e/README.md).
 * Without it these tests skip themselves so the suite stays green.
 */
test.describe('backlog: nav wiring + new screens', () => {
  test.skip(!process.env.E2E_STORAGE_STATE, 'set E2E_STORAGE_STATE to run (see e2e/README.md)');

  test('sidebar links the previously orphaned routes', async ({ page }) => {
    await page.goto('/dashboard');
    const nav = page.getByRole('navigation');
    await expect(nav.getByRole('link', { name: 'Skill demand' })).toHaveAttribute(
      'href',
      '/market/skill-demand',
    );
    await expect(nav.getByRole('link', { name: 'Trends' })).toHaveAttribute('href', '/market/trends');
    await expect(nav.getByRole('link', { name: 'Search providers' })).toHaveAttribute(
      'href',
      '/settings/search-providers',
    );
  });

  test('skill demand screen renders its table region', async ({ page }) => {
    await page.goto('/market/skill-demand');
    await expect(page.getByRole('heading', { name: /skill demand/i })).toBeVisible();
  });

  test('trends screen renders', async ({ page }) => {
    await page.goto('/market/trends');
    await expect(page.getByRole('heading', { name: /technology signals/i })).toBeVisible();
  });

  test('search providers screen renders', async ({ page }) => {
    await page.goto('/settings/search-providers');
    await expect(page.getByRole('heading', { name: /search providers/i })).toBeVisible();
  });

  test('security screen exposes passkey registration', async ({ page }) => {
    await page.goto('/settings/security');
    await expect(page.getByRole('heading', { name: 'Security' })).toBeVisible();
    await expect(page.getByTestId('passkey-register')).toBeVisible();
    await expect(page.getByTestId('passkey-name')).toBeVisible();
  });

  test('data screen opens the export dialog and demands re-auth', async ({ page }) => {
    await page.goto('/settings/data');
    await expect(page.getByRole('heading', { name: /data & privacy/i })).toBeVisible();
    await page.getByTestId('data-export-open').click();
    await expect(page.getByTestId('export-dialog')).toBeVisible();
    await expect(page.getByTestId('export-email')).toBeVisible();
    await expect(page.getByTestId('export-password')).toBeVisible();
  });

  test('notifications screen shows schedule + preview controls', async ({ page }) => {
    await page.goto('/settings/notifications');
    await expect(page.getByTestId('notifications-panel')).toBeVisible();
    await expect(page.getByTestId('brief-timezone')).toBeVisible();
    await expect(page.getByTestId('brief-preview-run')).toBeVisible();
  });

  test('inbox triage renders filter tabs', async ({ page }) => {
    await page.goto('/inbox');
    await expect(page.getByRole('heading', { name: /inbox triage/i })).toBeVisible();
    await expect(page.getByTestId('inbox-tab-all')).toBeVisible();
  });

  test('daily brief renders deliveries or empty state', async ({ page }) => {
    await page.goto('/daily-brief');
    await expect(page.getByTestId('daily-brief-panel')).toBeVisible();
  });

  test('outreach composer renders its form', async ({ page }) => {
    await page.goto('/outreach');
    await expect(page.getByTestId('outreach-compose')).toBeVisible();
    await expect(page.getByTestId('outreach-email')).toBeVisible();
    await expect(page.getByTestId('outreach-submit')).toBeVisible();
  });

  test('quests board shows horizon tabs', async ({ page }) => {
    await page.goto('/quests');
    await expect(page.getByTestId('quest-board')).toBeVisible();
    await expect(page.getByTestId('quests-horizon-week')).toBeVisible();
  });

  test('source verification renders summary', async ({ page }) => {
    await page.goto('/jobs/verification');
    await expect(page.getByTestId('source-verification')).toBeVisible();
  });

  test('job sources renders tiered tables or a gap notice', async ({ page }) => {
    await page.goto('/settings/job-sources');
    const panel = page.getByTestId('job-sources-panel');
    const unavailable = page.getByTestId('job-sources-unavailable');
    await expect(panel.or(unavailable)).toBeVisible();
  });

  for (const path of [
    '/settings/security',
    '/settings/data',
    '/settings/notifications',
    '/settings/backup',
    '/inbox',
    '/daily-brief',
    '/outreach',
    '/quests',
    '/jobs/verification',
    '/settings/job-sources',
    '/market/skill-demand',
    '/market/trends',
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
