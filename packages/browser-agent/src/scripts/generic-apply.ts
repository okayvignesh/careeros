/**
 * F.3 generic-apply: best-effort fallback.
 *
 * Used when no per-domain allowlist entry matches. The generic entry
 * (`allowlist/generic.yaml`, domain='*') ships semantic-name heuristics that
 * cover ~60% of straightforward WordPress + Workable + Lever + custom
 * career-page forms. Everything else short-circuits to selector-broken and
 * the user gets the "open in browser to complete" fallback.
 *
 * ponytail: heuristic selectors (`input[name*=name i]` etc) and will miss
 * forms that use obfuscated field names; upgrade path is adding a per-domain
 * yaml once a user hits the same site twice.
 */

import type { AllowlistEntry } from '../allowlist/loader';
import {
  runFormFill,
  type FormFillMode,
  type FormFillPage,
  type FormFillPayload,
  type FormFillResult,
} from './form-fill';

export async function runGenericApply(
  page: FormFillPage,
  entry: AllowlistEntry,
  payload: FormFillPayload,
  mode: FormFillMode,
  opts: { screenshotPath?: string } = {},
): Promise<FormFillResult> {
  if (entry.domain !== '*') {
    return {
      status: 'error',
      mode,
      error: `runGenericApply expected wildcard entry, got ${entry.domain}`,
      filledFields: [],
    };
  }
  return runFormFill(page, entry, payload, mode, opts);
}
