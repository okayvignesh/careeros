/**
 * F.3 indeed-easy-apply: STUB.
 *
 * Indeed Apply uses iframes + randomized element ids per application. Needs
 * a captured fixture per form variant before selectors can be pinned.
 *
 * ponytail: stub, selectors not yet captured; wire when a user hits this
 * ATS, upgrade path is capture iframe DOM via LIVE=1 probe + add iframe-aware
 * frame locator pattern (page.frameLocator('iframe#indeedapply-iframe')).
 */

import type { AllowlistEntry } from '../allowlist/loader';
import type { FormFillMode, FormFillPage, FormFillPayload, FormFillResult } from './form-fill';

export async function runIndeedEasyApply(
  _page: FormFillPage,
  entry: AllowlistEntry,
  _payload: FormFillPayload,
  mode: FormFillMode,
): Promise<FormFillResult> {
  return {
    status: 'selector-broken',
    mode,
    missing: ['indeed-easy-apply: iframe + randomized ids not yet captured'],
    filledFields: [],
  };
}
