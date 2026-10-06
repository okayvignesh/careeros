import { describe, expect, it } from 'vitest';
import type { AllowlistEntry } from '../allowlist/loader';
import { isForbiddenSelector, runFormFill, type FormFillPage, type FormFillPayload } from './form-fill';

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

describe('isForbiddenSelector (EEO guard)', () => {
  it('matches verbatim and by shared attribute value', () => {
    const forbidden = [
      'input[type=password]',
      'input[data-automation-id*=gender]',
      'input[data-automation-id*=veteran]',
    ];
    expect(isForbiddenSelector('input[type=password]', forbidden)).toBe(true);
    expect(isForbiddenSelector('input[data-automation-id=gender_male]', forbidden)).toBe(true);
    expect(isForbiddenSelector('input[data-automation-id=veteranStatus]', forbidden)).toBe(true);
    expect(isForbiddenSelector('input[name=firstName]', forbidden)).toBe(false);
  });

  it('extracts value tokens across every attribute operator and quoting style', () => {
    // *=, ^=, $=, ~=, |= and quoted values all yield the bare value token.
    for (const op of ['*=', '^=', '$=', '~=', '|=']) {
      expect(isForbiddenSelector('input[data-x=gender_male]', [`[data-x${op}gender]`])).toBe(true);
    }
    expect(isForbiddenSelector('input[id=veteran]', ['[aria-label="veteran status"]'])).toBe(true);
    expect(isForbiddenSelector('input[id=veteran]', ["[aria-label='veteran status']"])).toBe(true);
  });

  it('ignores value tokens shorter than three characters', () => {
    // `ab` is not a token, so an unrelated selector that merely equals it is allowed.
    expect(isForbiddenSelector('input[value=ab]', ['[title=ab]'])).toBe(false);
    // `abc` is, so it blocks a selector that shares only the value.
    expect(isForbiddenSelector('input[value=abc]', ['[title=abc]'])).toBe(true);
  });
});

describe('runFormFill forbidden-selector enforcement', () => {
  const eeoEntry: AllowlistEntry = {
    domain: 'eeo.com',
    allowed_paths: ['/'],
    forbidden_selectors: ['input[type=password]', 'input[name*=gender]', 'button[type=submit]'],
    required_headers: [],
    field_selectors: {
      name: 'input[type=password]', // mis-mapped onto an EEO/credential control
      email: 'input[name=email]',
    },
    submit_selector: 'button[type=submit]',
  };

  it('never fills a selector listed as forbidden and refuses the run', async () => {
    const { page, calls } = makePage(
      new Set(['input[type=password]', 'input[name=email]', 'button[type=submit]']),
    );
    const r = await runFormFill(page, eeoEntry, payload, 'live');
    expect(r.status).toBe('selector-broken');
    if (r.status !== 'selector-broken') return;
    expect(r.missing.some((m) => m.includes('forbidden selector'))).toBe(true);
    // The forbidden field was skipped; nothing was clicked.
    expect(calls.some((c) => c.op === 'fill' && c.selector === 'input[type=password]')).toBe(false);
    expect(calls.some((c) => c.op === 'click')).toBe(false);
  });

  it('refuses to click a forbidden submit selector', async () => {
    const entry: AllowlistEntry = {
      domain: 'eeo2.com',
      allowed_paths: ['/'],
      forbidden_selectors: ['button[type=submit]'],
      required_headers: [],
      field_selectors: { email: 'input[name=email]' },
      submit_selector: 'button[type=submit]',
    };
    const { page, calls } = makePage(new Set(['input[name=email]', 'button[type=submit]']));
    const r = await runFormFill(page, entry, payload, 'live');
    expect(r.status).toBe('selector-broken');
    if (r.status !== 'selector-broken') return;
    expect(r.missing.some((m) => m.includes('submit_selector') && m.includes('forbidden'))).toBe(true);
    expect(calls.some((c) => c.op === 'click')).toBe(false);
  });
});
