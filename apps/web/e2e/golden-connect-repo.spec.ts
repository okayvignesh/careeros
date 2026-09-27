import { test, expect } from '@playwright/test';

/**
 * Golden flow (P1): connect a GitHub repo → skills appear on dashboard within
 * one worker cycle.
 *
 * Skipped by default because it needs external HTTP stubs the CI stack does
 * not yet start:
 *   1. DeepSeek chat + chat-structured routes stubbed with canned skill-extract
 *      output.
 *   2. GitHub API stubbed with a fixture repo + language map so the sync worker
 *      writes deterministic presence evidence.
 *   3. Storage state from a completed wizard (see e2e/README.md).
 *
 * Wire E2E_STUB_MODE=1 alongside E2E_STORAGE_STATE to unskip. The `page.route()`
 * blocks below already have the interception surface.
 */
test.describe('golden: connect repo → skills on dashboard', () => {
  test.skip(
    !process.env.E2E_STORAGE_STATE || process.env.E2E_STUB_MODE !== '1',
    'set E2E_STORAGE_STATE + E2E_STUB_MODE=1 to run this flow',
  );

  test.beforeEach(async ({ page }) => {
    // DeepSeek chat-completions stub. Returns a canned skill-extract response so
    // the resume/repo pipeline doesn't hit a real provider.
    await page.route(/api\.deepseek\.com\/.+chat\/completions/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'stub-chatcmpl',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: 'deepseek-chat',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  skills: ['react', 'typescript', 'node-js'],
                  evidence_refs: [],
                }),
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
        }),
      });
    });

    // GitHub REST stub. Returns one repo with TypeScript language dominant so
    // skills-seed maps to `typescript` presence evidence.
    await page.route(/api\.github\.com\/user\/repos/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 1,
            name: 'stub-repo',
            full_name: 'stub-user/stub-repo',
            private: false,
            language: 'TypeScript',
            html_url: 'https://github.com/stub-user/stub-repo',
            default_branch: 'main',
            fork: false,
            archived: false,
          },
        ]),
      });
    });

    await page.route(/api\.github\.com\/repos\/[^/]+\/[^/]+\/languages/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ TypeScript: 90_000, JavaScript: 10_000 }),
      });
    });
  });

  test('connect repo → typescript skill lands on dashboard', async ({ page }) => {
    await page.goto('/settings/integrations');
    // Connect via the reauth token field.
    await page.getByPlaceholder(/ghp_/).fill('ghp_stub_token_for_e2e_only_not_a_real_key');
    await page.getByRole('button', { name: /^Save$/ }).click();

    // Worker sync happens in a background BullMQ queue; poll the dashboard.
    await expect
      .poll(async () => {
        await page.goto('/dashboard');
        return page.getByText(/typescript/i).count();
      }, { timeout: 30_000, intervals: [2_000, 3_000, 5_000] })
      .toBeGreaterThan(0);
  });
});
