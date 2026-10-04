/**
 * F.3 linkedin-easy-apply: best-effort multi-step Easy Apply.
 *
 * LinkedIn Easy Apply is a modal funnel driven by `button.jobs-apply-button`
 * that advances through contact info, resume, screening questions and review
 * before the terminal submit. The steps + selectors live in
 * `allowlist/linkedin.yaml` (`apply_flow`) so a DOM change is a data edit, not
 * a code change. Runs only from the user's own logged-in desktop-agent session
 * (AGENTS.md rule 4 permits client-side agent automation; server-side scraping
 * of LinkedIn stays banned).
 *
 * Honest limitations:
 *  - Screening questions (work authorization, salary, custom free-text) are
 *    not answered by this flow; leaving them blank can block advance, in which
 *    case the run returns `selector-broken` and the user finishes in their
 *    browser.
 *  - LinkedIn rotates class names and uses `:has-text()`/`:not()` in some
 *    tenants; the YAML lists the stable aria-label + class selectors we can
 *    drive, and the selector-health probe flags drift.
 */

import type { AllowlistEntry } from '../allowlist/loader';
import { runApplyFlow } from './apply-flow';
import type { FormFillMode, FormFillPage, FormFillPayload, FormFillResult } from './form-fill';

export async function runLinkedinEasyApply(
  page: FormFillPage,
  entry: AllowlistEntry,
  payload: FormFillPayload,
  mode: FormFillMode,
  opts: { screenshotPath?: string } = {},
): Promise<FormFillResult> {
  if (entry.domain !== 'linkedin.com') {
    return {
      status: 'error',
      mode,
      error: `runLinkedinEasyApply expected linkedin.com entry, got ${entry.domain}`,
      filledFields: [],
    };
  }
  return runApplyFlow(page, entry, payload, mode, entry.apply_flow ?? undefined, opts);
}
