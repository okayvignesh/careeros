/**
 * F.3 workday-apply: multi-step Workday application.
 *
 * Workday (`*.myworkdayjobs.com`) runs a multi-page funnel: My Information →
 * My Experience → Application Questions → Voluntary Disclosures → Review →
 * Submit. Field + navigation selectors use Workday's stable
 * `data-automation-id` attributes and live in `allowlist/workday.yaml`
 * `apply_flow`.
 *
 * Honest limitations:
 *  - Workday usually requires an account signed in on the user's machine; the
 *    agent drives their existing session, it does not create accounts.
 *  - Voluntary-disclosure (EEO) fields are in `forbidden_selectors` and never
 *    touched — the user answers them.
 *  - Tenant-custom "Application Questions" and CAPTCHA steps are not answered;
 *    the run bails to `selector-broken` and the user finishes in their browser.
 */

import type { AllowlistEntry } from '../allowlist/loader';
import { runApplyFlow } from './apply-flow';
import type { FormFillMode, FormFillPage, FormFillPayload, FormFillResult } from './form-fill';

export async function runWorkdayApply(
  page: FormFillPage,
  entry: AllowlistEntry,
  payload: FormFillPayload,
  mode: FormFillMode,
  opts: { screenshotPath?: string } = {},
): Promise<FormFillResult> {
  if (entry.domain !== 'myworkdayjobs.com' && entry.domain !== 'workday.com') {
    return {
      status: 'error',
      mode,
      error: `runWorkdayApply expected myworkdayjobs.com entry, got ${entry.domain}`,
      filledFields: [],
    };
  }
  return runApplyFlow(page, entry, payload, mode, entry.apply_flow ?? undefined, opts);
}
