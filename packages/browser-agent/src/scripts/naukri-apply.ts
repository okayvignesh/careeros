/**
 * F.3 naukri-apply: STUB.
 *
 * Naukri's apply flow is a server-rendered form that mutates between visits;
 * reliable selectors need region-specific captures (naukri.com and
 * naukrigulf.com differ).
 *
 * ponytail: stub, selectors not yet captured; wire when a user hits this
 * ATS, upgrade path is capture per-region fixture, add region router in
 * field_selectors (nested yaml key per domain variant).
 */

import type { AllowlistEntry } from '../allowlist/loader';
import type { FormFillMode, FormFillPage, FormFillPayload, FormFillResult } from './form-fill';

export async function runNaukriApply(
  _page: FormFillPage,
  entry: AllowlistEntry,
  _payload: FormFillPayload,
  mode: FormFillMode,
): Promise<FormFillResult> {
  return {
    status: 'selector-broken',
    mode,
    missing: ['naukri-apply: regional form variants not yet captured'],
    filledFields: [],
  };
}
