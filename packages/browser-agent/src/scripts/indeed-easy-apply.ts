/**
 * F.3 indeed-easy-apply: best-effort multi-step Indeed Apply.
 *
 * Indeed's apply flow is a wizard (`#indeedApplyButton` → contact → resume →
 * questions → submit). The steps live in `allowlist/indeed.yaml`.
 *
 * Honest limitation: Indeed renders most of the wizard inside a same-origin
 * iframe on some tenants and cross-origin on others. This engine drives only
 * the top-level document, so tenants that use an iframe surface as
 * `selector-broken` (with a screenshot for the operator) and the user
 * completes in their own browser. Randomized element ids are handled by
 * attribute-substring selectors in the YAML.
 */

import type { AllowlistEntry } from '../allowlist/loader';
import { runApplyFlow } from './apply-flow';
import type { FormFillMode, FormFillPage, FormFillPayload, FormFillResult } from './form-fill';

export async function runIndeedEasyApply(
  page: FormFillPage,
  entry: AllowlistEntry,
  payload: FormFillPayload,
  mode: FormFillMode,
  opts: { screenshotPath?: string } = {},
): Promise<FormFillResult> {
  if (entry.domain !== 'indeed.com') {
    return {
      status: 'error',
      mode,
      error: `runIndeedEasyApply expected indeed.com entry, got ${entry.domain}`,
      filledFields: [],
    };
  }
  return runApplyFlow(page, entry, payload, mode, entry.apply_flow ?? undefined, opts);
}
