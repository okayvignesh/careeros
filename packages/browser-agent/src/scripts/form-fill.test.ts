import { describe, expect, it } from 'vitest';
import type { AllowlistEntry } from '../allowlist/loader';
import { runFormFill, type FormFillPage, type FormFillPayload } from './form-fill';

/**
 * Fixture Page: pretends to be a Playwright Page. Each selector is matched
 * against a known-good set; anything else throws, which is how we simulate
 * selector-stale pages.
 */
function makePage(knownSelectors: Set<string>, successSelectors: Set<string> = new Set()): {
  page: FormFillPage;
  calls: Array<{ op: string; selector: string; value?: string }>;
} {
  const calls: Array<{ op: string; selector: string; value?: string }> = [];
  const page: FormFillPage = {
    async fill(selector: string, value: string) {
      if (!knownSelectors.has(selector)) throw new Error(`no element for ${selector}`);
      calls.push({ op: 'fill', selector, value });
    },
    async setInputFiles(selector: string, files: string | string[]) {
      if (!knownSelectors.has(selector)) throw new Error(`no element for ${selector}`);
      calls.push({ op: 'setInputFiles', selector, value: Array.isArray(files) ? files.join(',') : files });
    },
    async click(selector: string) {
      if (!knownSelectors.has(selector)) throw new Error(`no element for ${selector}`);
      calls.push({ op: 'click', selector });
    },
    async waitForSelector(selector: string) {
      if (!successSelectors.has(selector)) throw new Error(`no success for ${selector}`);
      calls.push({ op: 'waitForSelector', selector });
      return {};
    },
    async screenshot() {
      calls.push({ op: 'screenshot', selector: '' });
    },
  };
  return { page, calls };
}

const ashbyEntry: AllowlistEntry = {
  domain: 'ashbyhq.com',
  allowed_paths: ['/'],
  forbidden_selectors: [],
  required_headers: [],
  field_selectors: {
    name: 'input[name=_systemfield_name]',
    email: 'input[name=_systemfield_email]',
    resume_upload: 'input[type=file][name=_systemfield_resume]',
  },
  submit_selector: 'button[type=submit]',
  success_signal: '[data-testid=application-confirmation]',
};

const payload: FormFillPayload = {
  name: 'Jane Candidate',
  email: 'jane@example.com',
  resumePath: '/tmp/resume.pdf',
};

describe('runFormFill', () => {
  it('dry-run fills every available field but never clicks submit', async () => {
    const { page, calls } = makePage(
      new Set([
        'input[name=_systemfield_name]',
        'input[name=_systemfield_email]',
        'input[type=file][name=_systemfield_resume]',
      ]),
    );
    const r = await runFormFill(page, ashbyEntry, payload, 'dry-run');
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.submitted).toBe(false);
    expect(r.filledFields.sort()).toEqual(['email', 'name', 'resume_upload']);
    expect(calls.some((c) => c.op === 'click')).toBe(false);
  });

  it('live mode clicks submit and waits for the success signal', async () => {
    const { page, calls } = makePage(
      new Set([
        'input[name=_systemfield_name]',
        'input[name=_systemfield_email]',
        'input[type=file][name=_systemfield_resume]',
        'button[type=submit]',
      ]),
      new Set(['[data-testid=application-confirmation]']),
    );
    const r = await runFormFill(page, ashbyEntry, payload, 'live');
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.submitted).toBe(true);
    expect(calls.find((c) => c.op === 'click')?.selector).toBe('button[type=submit]');
    expect(calls.find((c) => c.op === 'waitForSelector')?.selector).toBe('[data-testid=application-confirmation]');
  });

  it('reports selector-broken when every field selector misses', async () => {
    const { page } = makePage(new Set()); // page is empty
    const r = await runFormFill(page, ashbyEntry, payload, 'live');
    expect(r.status).toBe('selector-broken');
    if (r.status !== 'selector-broken') return;
    expect(r.filledFields).toEqual([]);
    expect(r.missing.length).toBeGreaterThan(0);
  });

  it('reports selector-broken when submit button is gone (fields filled but submit missing)', async () => {
    const { page } = makePage(
      new Set([
        'input[name=_systemfield_name]',
        'input[name=_systemfield_email]',
        'input[type=file][name=_systemfield_resume]',
      ]),
    );
    const r = await runFormFill(page, ashbyEntry, payload, 'live');
    expect(r.status).toBe('selector-broken');
    if (r.status !== 'selector-broken') return;
    expect(r.filledFields.sort()).toEqual(['email', 'name', 'resume_upload']);
    expect(r.missing.some((m) => m.startsWith('submit_selector@'))).toBe(true);
  });

  it('reports error when success signal never shows', async () => {
    const { page } = makePage(
      new Set([
        'input[name=_systemfield_name]',
        'input[name=_systemfield_email]',
        'input[type=file][name=_systemfield_resume]',
        'button[type=submit]',
      ]),
      new Set(), // success signal never fires
    );
    const r = await runFormFill(page, ashbyEntry, payload, 'live');
    expect(r.status).toBe('error');
    if (r.status !== 'error') return;
    expect(r.error).toContain('success_signal');
  });

  it('refuses to run when field_selectors is missing from the allowlist entry', async () => {
    const bareEntry: AllowlistEntry = {
      domain: 'bare.com',
      allowed_paths: ['/'],
      forbidden_selectors: [],
      required_headers: [],
    };
    const { page } = makePage(new Set());
    const r = await runFormFill(page, bareEntry, payload, 'dry-run');
    expect(r.status).toBe('selector-broken');
    if (r.status !== 'selector-broken') return;
    expect(r.missing).toEqual(['field_selectors']);
  });
});
