/**
 * F.3 lever-apply: single-page Lever application form.
 *
 * Lever's public apply form (`jobs.lever.co/{org}/{id}/apply`) is one screen:
 * name/email/phone/org/links + resume + optional cover letter, then submit.
 * Selectors live in `allowlist/lever.yaml`; drift is caught by selector-health.
 *
 * Robustness: Lever renders the resume control as a hidden file input behind a
 * drop zone; `apply_flow.entry` is unused here because the form is already on
 * screen. If the file input is behind a custom widget the `setInputFiles` call
 * still targets the input directly (Playwright sets files on hidden inputs).
 */

import type { AllowlistEntry } from '../allowlist/loader';
import {
  runFormFill,
  type FormFillMode,
  type FormFillPage,
  type FormFillPayload,
  type FormFillResult,
} from './form-fill';

export async function runLeverApply(
  page: FormFillPage,
  entry: AllowlistEntry,
  payload: FormFillPayload,
  mode: FormFillMode,
  opts: { screenshotPath?: string } = {},
): Promise<FormFillResult> {
  if (entry.domain !== 'lever.co') {
    return {
      status: 'error',
      mode,
      error: `runLeverApply expected lever.co entry, got ${entry.domain}`,
      filledFields: [],
    };
  }
  return runFormFill(page, entry, payload, mode, opts);
}
