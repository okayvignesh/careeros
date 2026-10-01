/**
 * F.3 shared form-fill engine.
 *
 * Pure logic that drives a Playwright-compatible Page interface (narrowed to
 * the four methods we actually call). Takes an AllowlistEntry + a payload +
 * a mode (dry-run or live), returns a FormFillResult the per-site script
 * can serialize to stdout for the agent task-runner.
 *
 * The engine is intentionally dumb: fill each field_selector if present in
 * the payload, click the submit_selector (live mode only), wait for the
 * success_signal. Every DOM read/write is try/catch-wrapped and failures are
 * collected as `missing: string[]` so the caller can decide between "page is
 * selector-stale" and "operator typo'd the payload".
 *
 * Per phase-6:41, dry-run is the default first run per domain. Live mode is
 * only reached after explicit user approval of the dry-run diff — that gate
 * lives in F.1 (approvals queue), not here.
 */

import type { AllowlistEntry, FieldSelectors } from '../allowlist/loader';

/**
 * The subset of Playwright's Page we actually use. Keeping this tiny means
 * the unit test can hand us a fake and we never touch a browser.
 */
export interface FormFillPage {
  fill(selector: string, value: string): Promise<void>;
  setInputFiles(selector: string, files: string | string[]): Promise<void>;
  click(selector: string): Promise<void>;
  waitForSelector(selector: string, opts?: { timeout?: number }): Promise<unknown>;
  screenshot(opts: { path: string; fullPage?: boolean }): Promise<Buffer | void>;
}

export interface FormFillPayload {
  name?: string;
  email?: string;
  phone?: string;
  /** Absolute path to the resume file on disk. */
  resumePath?: string;
  coverLetter?: string;
  linkedinUrl?: string;
  githubUrl?: string;
  portfolioUrl?: string;
}

export type FormFillMode = 'dry-run' | 'live';

export type FormFillResult =
  | {
      status: 'ok';
      mode: FormFillMode;
      filledFields: string[];
      /** Only populated in live mode after success_signal matched. */
      submitted: boolean;
    }
  | {
      status: 'selector-broken';
      mode: FormFillMode;
      missing: string[];
      filledFields: string[];
      /** Screenshot captured right before bail; useful for the human handoff. */
      screenshotPath?: string;
    }
  | {
      status: 'error';
      mode: FormFillMode;
      error: string;
      filledFields: string[];
      screenshotPath?: string;
    };

const FILL_TIMEOUT_MS = 10_000;
const SUBMIT_WAIT_MS = 20_000;

/**
 * Core form-fill routine. See file header. Returns the result instead of
 * throwing so the task-runner can serialize it directly.
 */
export async function runFormFill(
  page: FormFillPage,
  entry: AllowlistEntry,
  payload: FormFillPayload,
  mode: FormFillMode,
  opts: { screenshotPath?: string } = {},
): Promise<FormFillResult> {
  const field_selectors = entry.field_selectors;
  if (!field_selectors) {
    return {
      status: 'selector-broken',
      mode,
      missing: ['field_selectors'],
      filledFields: [],
    };
  }

  const filled: string[] = [];
  const missing: string[] = [];

  const fieldOrder: Array<[keyof FieldSelectors, keyof FormFillPayload, 'text' | 'file']> = [
    ['name', 'name', 'text'],
    ['email', 'email', 'text'],
    ['phone', 'phone', 'text'],
    ['linkedin_url', 'linkedinUrl', 'text'],
    ['github_url', 'githubUrl', 'text'],
    ['portfolio_url', 'portfolioUrl', 'text'],
    ['cover_letter', 'coverLetter', 'text'],
    ['resume_upload', 'resumePath', 'file'],
  ];

  for (const [selectorKey, payloadKey, kind] of fieldOrder) {
    const selector = field_selectors[selectorKey];
    const value = payload[payloadKey];
    if (!selector || value === undefined || value === '') continue;
    try {
      if (kind === 'file') {
        await withTimeout(page.setInputFiles(selector, value), FILL_TIMEOUT_MS);
      } else {
        await withTimeout(page.fill(selector, value), FILL_TIMEOUT_MS);
      }
      filled.push(selectorKey);
    } catch (err) {
      missing.push(`${selectorKey}@${selector}: ${(err as Error).message.slice(0, 100)}`);
    }
  }

  // If every attempted field missed, the page is selector-stale.
  const attempted = fieldOrder.filter(([k, p]) => field_selectors[k] && payload[p]).length;
  if (attempted > 0 && filled.length === 0) {
    const screenshotPath = await tryScreenshot(page, opts.screenshotPath);
    const out: FormFillResult = {
      status: 'selector-broken',
      mode,
      missing,
      filledFields: filled,
    };
    if (screenshotPath) out.screenshotPath = screenshotPath;
    return out;
  }

  if (mode === 'dry-run') {
    // Record the state we would have submitted; no click, no success_signal.
    return { status: 'ok', mode, filledFields: filled, submitted: false };
  }

  // Live mode: click submit, wait for success_signal.
  if (!entry.submit_selector) {
    return {
      status: 'selector-broken',
      mode,
      missing: [...missing, 'submit_selector'],
      filledFields: filled,
    };
  }

  try {
    await withTimeout(page.click(entry.submit_selector), FILL_TIMEOUT_MS);
  } catch (err) {
    const screenshotPath = await tryScreenshot(page, opts.screenshotPath);
    const out: FormFillResult = {
      status: 'selector-broken',
      mode,
      missing: [...missing, `submit_selector@${entry.submit_selector}: ${(err as Error).message.slice(0, 100)}`],
      filledFields: filled,
    };
    if (screenshotPath) out.screenshotPath = screenshotPath;
    return out;
  }

  if (entry.success_signal) {
    try {
      await page.waitForSelector(entry.success_signal, { timeout: SUBMIT_WAIT_MS });
    } catch (err) {
      const screenshotPath = await tryScreenshot(page, opts.screenshotPath);
      const out: FormFillResult = {
        status: 'error',
        mode,
        error: `success_signal not seen within ${SUBMIT_WAIT_MS}ms: ${(err as Error).message.slice(0, 100)}`,
        filledFields: filled,
      };
      if (screenshotPath) out.screenshotPath = screenshotPath;
      return out;
    }
  }

  return { status: 'ok', mode, filledFields: filled, submitted: true };
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  // ponytail: AbortController would be cleaner but Playwright methods already
  // honor their own timeouts; this wrapper is a last-resort safety net for
  // the test fake which has no timeout plumbing. Upgrade when we start seeing
  // page.fill() hang longer than its internal timeout in production.
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms + 1_000)),
  ]);
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
