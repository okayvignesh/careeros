/**
 * F.3 naukri-apply: best-effort Naukri apply.
 *
 * Naukri's apply flow is a jQuery-era server-rendered form (`#apply-button` →
 * a chat-style questionnaire on some listings → submit). Steps live in
 * `allowlist/naukri.yaml`. Naukri also serves region variants
 * (`naukrigulf.com`); those get their own entry once a fixture is captured —
 * this script only runs the `naukri.com` entry.
 *
 * Honest limitation: listings that switch to the "chat" apply assistant
 * present free-text questions this flow cannot answer; the run returns
 * `selector-broken` and the user completes in their browser.
 */

import type { AllowlistEntry } from '../allowlist/loader';
import { runApplyFlow } from './apply-flow';
import type { FormFillMode, FormFillPage, FormFillPayload, FormFillResult } from './form-fill';

export async function runNaukriApply(
  page: FormFillPage,
  entry: AllowlistEntry,
  payload: FormFillPayload,
  mode: FormFillMode,
  opts: { screenshotPath?: string } = {},
): Promise<FormFillResult> {
  if (entry.domain !== 'naukri.com') {
    return {
      status: 'error',
      mode,
      error: `runNaukriApply expected naukri.com entry, got ${entry.domain}`,
      filledFields: [],
    };
  }
  return runApplyFlow(page, entry, payload, mode, entry.apply_flow ?? undefined, opts);
}
