/**
 * F.3 ashby-apply: browser form-fill variant.
 *
 * F.2 covers Ashby's HTTP submit API (preferred path); this script is the
 * fallback used when the user's apply page is a hosted jobs.ashbyhq.com form
 * with a resume dropzone the API path can't bypass (gated by captcha,
 * requires logged-in cookies, etc.).
 *
 * Pure logic: takes a Page + the ashby allowlist entry + the candidate
 * payload. Returns a FormFillResult. The agent task-runner wraps this with
 * Playwright context setup + screenshot persistence.
 *
 * No stub: this is the real end-to-end path. Selectors live in
 * `allowlist/ashby.yaml`; drift is caught by selector-health.
 */

import type { AllowlistEntry } from '../allowlist/loader';
import {
  runFormFill,
  type FormFillMode,
  type FormFillPage,
  type FormFillPayload,
  type FormFillResult,
} from './form-fill';

export async function runAshbyApply(
  page: FormFillPage,
  entry: AllowlistEntry,
  payload: FormFillPayload,
  mode: FormFillMode,
  opts: { screenshotPath?: string } = {},
): Promise<FormFillResult> {
  if (entry.domain !== 'ashbyhq.com') {
    return {
      status: 'error',
      mode,
      error: `runAshbyApply expected ashbyhq.com entry, got ${entry.domain}`,
      filledFields: [],
    };
  }
  return runFormFill(page, entry, payload, mode, opts);
}
