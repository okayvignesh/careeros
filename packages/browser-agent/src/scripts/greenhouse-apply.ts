/**
 * F.3 greenhouse-apply: browser form-fill variant.
 *
 * F.2 covers Greenhouse's Harvest API submit (preferred path); this script
 * is the fallback used when the user's apply URL is the embedded
 * boards.greenhouse.io/{company}/jobs/{id} form that only accepts
 * submissions through the web UI (no API key issued to the candidate).
 *
 * Pure logic: takes a Page + the greenhouse allowlist entry + the candidate
 * payload. The task-runner handles Playwright setup.
 *
 * No stub: real end-to-end path. Selectors live in
 * `allowlist/greenhouse.yaml`; EEOC fields are already in
 * forbidden_selectors so we never touch them.
 */

import type { AllowlistEntry } from '../allowlist/loader';
import {
  runFormFill,
  type FormFillMode,
  type FormFillPage,
  type FormFillPayload,
  type FormFillResult,
} from './form-fill';

export async function runGreenhouseApply(
  page: FormFillPage,
  entry: AllowlistEntry,
  payload: FormFillPayload,
  mode: FormFillMode,
  opts: { screenshotPath?: string } = {},
): Promise<FormFillResult> {
  if (entry.domain !== 'greenhouse.io') {
    return {
      status: 'error',
      mode,
      error: `runGreenhouseApply expected greenhouse.io entry, got ${entry.domain}`,
      filledFields: [],
    };
  }
  return runFormFill(page, entry, payload, mode, opts);
}
