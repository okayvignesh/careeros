/**
 * F.3 linkedin-easy-apply: STUB.
 *
 * LinkedIn Easy Apply is a multi-step modal with per-application dynamic
 * fields (phone country code, work auth, custom questions). The flow needs
 * fixture capture of each step's DOM before selectors can be pinned.
 *
 * ponytail: stub, selectors not yet captured; wire when a user hits this
 * ATS, upgrade path is capture modal step DOMs via LIVE=1 session recording,
 * add step-aware state machine (fill step N -> click Continue -> wait for
 * step N+1 selector -> repeat until success_signal). The current entry in
 * `allowlist/linkedin.yaml` has submit_selector + success_signal placeholders
 * which the selector-health probe will flag as missing when a user hits this
 * code path, auto-marking the domain selector-stale and bouncing the user
 * to the "open in browser to complete" fallback (phase-6 line 44).
 */

import type { AllowlistEntry } from '../allowlist/loader';
import type { FormFillMode, FormFillPage, FormFillPayload, FormFillResult } from './form-fill';

export async function runLinkedinEasyApply(
  _page: FormFillPage,
  entry: AllowlistEntry,
  _payload: FormFillPayload,
  mode: FormFillMode,
): Promise<FormFillResult> {
  return {
    status: 'selector-broken',
    mode,
    missing: ['linkedin-easy-apply: multi-step modal not yet captured'],
    filledFields: [],
  };
}
