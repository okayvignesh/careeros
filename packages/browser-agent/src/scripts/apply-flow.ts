/**
 * F.3 multi-step apply engine.
 *
 * Drives an ATS apply funnel described declaratively on the allowlist entry's
 * `apply_flow` block (see `allowlist/loader.ts`). It is the shared engine behind
 * the LinkedIn / Indeed / Naukri / Workday scripts; Greenhouse + Lever use the
 * single-page `runFormFill` because their forms are one screen.
 *
 * Design goals:
 *  - Selectors live in YAML, not code, so a site change is a data edit.
 *  - Every step is best-effort: a missing field is recorded in `missing[]`,
 *    never fatal, so the caller can still show the user what was filled.
 *  - A page that matches *no* field is reported `selector-broken` (selectors
 *    drifted) rather than silently "success".
 *  - Live mode is the only mode that submits; dry-run stops at the review step.
 *
 * Honest limitations (reported to the caller, not hidden):
 *  - Only same-frame DOM is drivable. Indeed's apply flow and some Workday
 *    tenants render inside cross-origin iframes the desktop agent cannot
 *    cross with this interface — those steps fail as selector-broken.
 *  - CAPTCHA / account-creation steps are not solved; the flow bails and the
 *    user completes in their own browser.
 */

import type { AllowlistEntry, ApplyFlow, FieldSelectors } from '../allowlist/loader';
import {
  isForbiddenSelector,
  type FormFillMode,
  type FormFillPage,
  type FormFillPayload,
  type FormFillResult,
} from './form-fill';

const FILL_TIMEOUT_MS = 10_000;
const SUBMIT_WAIT_MS = 20_000;

export type ApplyResult = FormFillResult;

interface FieldSpec {
  selectorKey: keyof FieldSelectors;
  payloadKey: keyof FormFillPayload;
  kind: 'text' | 'file';
}

const FIELD_ORDER: FieldSpec[] = [
  { selectorKey: 'name', payloadKey: 'name', kind: 'text' },
  { selectorKey: 'email', payloadKey: 'email', kind: 'text' },
  { selectorKey: 'phone', payloadKey: 'phone', kind: 'text' },
  { selectorKey: 'linkedin_url', payloadKey: 'linkedinUrl', kind: 'text' },
  { selectorKey: 'github_url', payloadKey: 'githubUrl', kind: 'text' },
  { selectorKey: 'portfolio_url', payloadKey: 'portfolioUrl', kind: 'text' },
  { selectorKey: 'cover_letter', payloadKey: 'coverLetter', kind: 'text' },
  { selectorKey: 'resume_upload', payloadKey: 'resumePath', kind: 'file' },
];

/** A single-screen flow derived from the entry's flat selectors. */
export function defaultFlow(entry: AllowlistEntry): ApplyFlow {
  const flow: ApplyFlow = { steps: [{ name: 'form' }] };
  if (entry.submit_selector) flow.submit = entry.submit_selector;
  if (entry.success_signal) flow.success = entry.success_signal;
  return flow;
}

export async function runApplyFlow(
  page: FormFillPage,
  entry: AllowlistEntry,
  payload: FormFillPayload,
  mode: FormFillMode,
  flow: ApplyFlow = entry.apply_flow ?? defaultFlow(entry),
  opts: { screenshotPath?: string } = {},
): Promise<ApplyResult> {
  const baseFields = entry.field_selectors ?? {};
  const forbidden = entry.forbidden_selectors;
  const filled: string[] = [];
  const missing: string[] = [];
  const refused: string[] = [];

  // Step 0: open the apply form/modal when the entry declares an opener.
  if (flow.entry) {
    if (isForbiddenSelector(flow.entry, forbidden)) {
      return breakResult(page, mode, opts.screenshotPath, [
        ...missing,
        `entry@${flow.entry}: forbidden selector (EEO guard) — not clicked`,
      ], filled);
    }
    try {
      await withTimeout(page.click(flow.entry), FILL_TIMEOUT_MS);
    } catch (err) {
      return breakResult(
        page,
        mode,
        opts.screenshotPath,
        [...missing, `entry@${flow.entry}: ${short(err)}`],
        filled,
      );
    }
  }

  for (let i = 0; i < flow.steps.length; i++) {
    const step = flow.steps[i]!;
    const fields: FieldSelectors = { ...baseFields, ...(step.fields ?? {}) };
    const isLast = i === flow.steps.length - 1;

    for (const spec of FIELD_ORDER) {
      const selector = fields[spec.selectorKey];
      const value = payload[spec.payloadKey];
      if (!selector || value === undefined || value === '') continue;
      if (isForbiddenSelector(selector, forbidden)) {
        refused.push(`${step.name}.${spec.selectorKey}@${selector}`);
        missing.push(
          `${step.name}.${spec.selectorKey}@${selector}: forbidden selector (EEO guard) — not filled`,
        );
        continue;
      }
      try {
        if (spec.kind === 'file') {
          await withTimeout(page.setInputFiles(selector, value), FILL_TIMEOUT_MS);
        } else {
          await withTimeout(page.fill(selector, value), FILL_TIMEOUT_MS);
        }
        filled.push(
          step.fields?.[spec.selectorKey] ? `${step.name}.${spec.selectorKey}` : spec.selectorKey,
        );
      } catch (err) {
        missing.push(`${step.name}.${spec.selectorKey}@${selector}: ${short(err)}`);
      }
    }

    if (refused.length > 0) {
      return breakResult(page, mode, opts.screenshotPath, missing, filled);
    }

    if (!isLast) {
      const advanced = await advance(page, step.advance ?? [], step.name, forbidden);
      if (advanced !== true) {
        return breakResult(page, mode, opts.screenshotPath, [...missing, ...advanced], filled);
      }
      continue;
    }

    // Terminal step.
    if (mode === 'dry-run') {
      if (filled.length === 0 && attempted(fields, payload)) {
        return breakResult(page, mode, opts.screenshotPath, missing, filled);
      }
      return { status: 'ok', mode, filledFields: filled, submitted: false };
    }

    const submit = step.submit ?? flow.submit ?? entry.submit_selector;
    if (!submit) {
      return breakResult(
        page,
        mode,
        opts.screenshotPath,
        [...missing, 'submit_selector: not declared'],
        filled,
      );
    }
    if (isForbiddenSelector(submit, forbidden)) {
      return breakResult(page, mode, opts.screenshotPath, [
        ...missing,
        `submit@${submit}: forbidden selector (EEO guard) — not clicked`,
      ], filled);
    }
    try {
      await withTimeout(page.click(submit), FILL_TIMEOUT_MS);
    } catch (err) {
      return breakResult(
        page,
        mode,
        opts.screenshotPath,
        [...missing, `submit@${submit}: ${short(err)}`],
        filled,
      );
    }

    const success = flow.success ?? entry.success_signal;
    if (success) {
      try {
        await page.waitForSelector(success, { timeout: SUBMIT_WAIT_MS });
      } catch (err) {
        return screenshotError(
          page,
          mode,
          opts.screenshotPath,
          `success_signal not seen within ${SUBMIT_WAIT_MS}ms: ${short(err)}`,
          filled,
        );
      }
    }
    return { status: 'ok', mode, filledFields: filled, submitted: true };
  }

  // Unreachable (steps.min(1)) but keeps the return type total.
  return {
    status: 'error',
    mode,
    error: 'apply flow declared no steps',
    filledFields: filled,
  };
}

/** Try each advance selector in order; returns `true` on success or the misses. */
async function advance(
  page: FormFillPage,
  candidates: string[],
  stepName: string,
  forbidden: readonly string[],
): Promise<true | string[]> {
  if (candidates.length === 0) return [`${stepName}: no advance selector declared`];
  const tried: string[] = [];
  for (const candidate of candidates) {
    if (isForbiddenSelector(candidate, forbidden)) {
      tried.push(`${stepName}.advance@${candidate}: forbidden selector (EEO guard) — skipped`);
      continue;
    }
    try {
      await withTimeout(page.click(candidate), FILL_TIMEOUT_MS);
      return true;
    } catch (err) {
      tried.push(`${stepName}.advance@${candidate}: ${short(err)}`);
    }
  }
  return tried;
}

function attempted(fields: FieldSelectors, payload: FormFillPayload): boolean {
  return FIELD_ORDER.some((s) => fields[s.selectorKey] && payload[s.payloadKey]);
}

function short(err: unknown): string {
  return (err as Error).message.slice(0, 100);
}

async function breakResult(
  page: FormFillPage,
  mode: FormFillMode,
  screenshotPath: string | undefined,
  missing: string[],
  filled: string[],
): Promise<ApplyResult> {
  const out: ApplyResult = { status: 'selector-broken', mode, missing, filledFields: filled };
  const shot = await tryScreenshot(page, screenshotPath);
  if (shot) out.screenshotPath = shot;
  return out;
}

async function screenshotError(
  page: FormFillPage,
  mode: FormFillMode,
  screenshotPath: string | undefined,
  error: string,
  filled: string[],
): Promise<ApplyResult> {
  const out: ApplyResult = { status: 'error', mode, error, filledFields: filled };
  const shot = await tryScreenshot(page, screenshotPath);
  if (shot) out.screenshotPath = shot;
  return out;
}

async function tryScreenshot(page: FormFillPage, path?: string): Promise<string | undefined> {
  if (!path) return undefined;
  try {
    await page.screenshot({ path, fullPage: true });
    return path;
  } catch {
    return undefined;
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms + 1_000)),
  ]);
}
