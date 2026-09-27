// Playwright + axe-core a11y helper. Consumers assert violations is empty:
//
//   const violations = await runA11y(page);
//   expect(violations).toEqual([]);
//
// Rules: WCAG 2.1 AA + best-practice (per plan/testing.md §10).
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

export interface A11yOptions {
  /** CSS selectors to skip; each MUST carry a justification in the caller. */
  exclude?: string[];
  /** Extra axe tags. Defaults to WCAG 2.1 AA + best-practice. */
  tags?: string[];
}

export async function runA11y(page: Page, opts: A11yOptions = {}): Promise<unknown[]> {
  let builder = new AxeBuilder({ page }).withTags(
    opts.tags ?? ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'],
  );
  for (const sel of opts.exclude ?? []) builder = builder.exclude(sel);
  const results = await builder.analyze();
  return results.violations;
}
