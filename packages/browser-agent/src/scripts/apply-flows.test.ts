// Multi-step apply-flow tests against saved DOM fixtures (packages/browser-agent/fixtures).
// No live network: a FixturePage matches selectors against real recorded HTML
// using the repo's own selector matcher, and advances through the recorded
// page sequence on click (entry -> step1 -> ... -> success).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AllowlistEntry } from '../allowlist/loader';
import { loadAllowlistFile } from '../allowlist/loader';
import { checkSelectorHealth } from '../selector-health';
import type { FormFillPage, FormFillPayload } from './form-fill';
import { runApplyFlow } from './apply-flow';
import { runLeverApply } from './lever-apply';
import { runGreenhouseApply } from './greenhouse-apply';
import { runLinkedinEasyApply } from './linkedin-easy-apply';
import { runIndeedEasyApply } from './indeed-easy-apply';
import { runNaukriApply } from './naukri-apply';
import { runWorkdayApply } from './workday-apply';

const allowlistDir = new URL('../../allowlist/', import.meta.url);
const fixtureDir = new URL('../../fixtures/', import.meta.url);

function loadEntry(name: string): AllowlistEntry {
  return loadAllowlistFile(fileURLToPath(new URL(`${name}.yaml`, allowlistDir)));
}

function loadFixtures(...rel: string[]): string[] {
  return rel.map((r) => readFileSync(new URL(r, fixtureDir), 'utf8'));
}

/** True if any alt of a comma-separated selector group matches the HTML. */
function groupMatches(html: string, group: string): boolean {
  const alts = group
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return alts.some((alt) => checkSelectorHealth(html, [alt]).missing.length === 0);
}

class FixturePage implements FormFillPage {
  readonly calls: Array<{ op: string; selector: string; value?: string }> = [];
  private index = 0;

  constructor(private readonly pages: string[]) {}

  private html(): string {
    return this.pages[this.index]!;
  }

  async fill(selector: string, value: string): Promise<void> {
    if (!groupMatches(this.html(), selector)) throw new Error(`no element for ${selector}`);
    this.calls.push({ op: 'fill', selector, value });
  }

  async setInputFiles(selector: string, files: string | string[]): Promise<void> {
    if (!groupMatches(this.html(), selector)) throw new Error(`no element for ${selector}`);
    this.calls.push({
      op: 'setInputFiles',
      selector,
      value: Array.isArray(files) ? files.join(',') : files,
    });
  }

  async click(selector: string): Promise<void> {
    if (!groupMatches(this.html(), selector)) throw new Error(`no element for ${selector}`);
    this.calls.push({ op: 'click', selector });
    // Recorded fixtures are a linear funnel: any successful click advances.
    this.index = Math.min(this.index + 1, this.pages.length - 1);
  }

  async waitForSelector(selector: string, _opts?: { timeout?: number }): Promise<unknown> {
    if (!groupMatches(this.html(), selector)) throw new Error(`no match for ${selector}`);
    this.calls.push({ op: 'waitForSelector', selector });
    return {};
  }

  async screenshot(): Promise<void> {
    this.calls.push({ op: 'screenshot', selector: '' });
  }
}

const payload: FormFillPayload = {
  name: 'Jane Candidate',
  email: 'jane@example.com',
  phone: '+1 555 0100',
  resumePath: '/tmp/resume.pdf',
  linkedinUrl: 'https://linkedin.com/in/jane',
  githubUrl: 'https://github.com/jane',
  portfolioUrl: 'https://jane.dev',
};

describe('linkedin-easy-apply (multi-step fixture)', () => {
  const entry = loadEntry('linkedin');
  const pages = [
    loadFixtures('linkedin/0-job.html')[0]!,
    ...loadFixtures(
      'linkedin/1-contact.html',
      'linkedin/2-resume.html',
      'linkedin/3-review.html',
      'linkedin/4-success.html',
    ),
  ];

  it('live: fills across steps, advances, submits and waits for success', async () => {
    const page = new FixturePage(pages);
    const r = await runLinkedinEasyApply(page, entry, payload, 'live');
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.submitted).toBe(true);
    expect(r.filledFields).toEqual(
      expect.arrayContaining(['name', 'email', 'phone', 'resume_upload']),
    );
    const submit = page.calls.find((c) => c.selector.includes('Submit application'));
    expect(submit?.op).toBe('click');
    expect(page.calls.at(-1)?.op).toBe('waitForSelector');
  });

  it('dry-run: never clicks submit', async () => {
    const page = new FixturePage(pages);
    const r = await runLinkedinEasyApply(page, entry, payload, 'dry-run');
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.submitted).toBe(false);
    expect(page.calls.some((c) => c.selector.includes('Submit application'))).toBe(false);
  });

  it('drifted job page (entry button gone) -> selector-broken, never ok', async () => {
    const drifted = pages.map((_, i) =>
      i === 0 ? '<html><body><h1>No apply button</h1></body></html>' : pages[i]!,
    );
    const page = new FixturePage(drifted);
    const r = await runLinkedinEasyApply(page, entry, payload, 'live');
    expect(r.status).toBe('selector-broken');
  });
});

describe('indeed-easy-apply (multi-step fixture)', () => {
  const entry = loadEntry('indeed');
  const pages = [
    ...loadFixtures(
      'indeed/0-job.html',
      'indeed/1-contact.html',
      'indeed/2-resume.html',
      'indeed/3-review.html',
      'indeed/4-success.html',
    ),
  ];

  it('live: completes the wizard', async () => {
    const page = new FixturePage(pages);
    const r = await runIndeedEasyApply(page, entry, payload, 'live');
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.submitted).toBe(true);
  });
});

describe('naukri-apply (single-form fixture)', () => {
  const entry = loadEntry('naukri');
  const pages = loadFixtures('naukri/0-job.html', 'naukri/1-form.html', 'naukri/2-success.html');

  it('live: opens the form, fills it and submits', async () => {
    const page = new FixturePage(pages);
    const r = await runNaukriApply(page, entry, payload, 'live');
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.submitted).toBe(true);
    expect(r.filledFields).toEqual(
      expect.arrayContaining(['name', 'email', 'phone', 'resume_upload']),
    );
  });
});

describe('workday-apply (multi-page fixture)', () => {
  const entry = loadEntry('workday');
  const pages = loadFixtures(
    'workday/0-job.html',
    'workday/1-my-info.html',
    'workday/2-my-experience.html',
    'workday/3-questions.html',
    'workday/4-review.html',
    'workday/5-success.html',
  );

  it('live: walks my-information -> my-experience -> questions -> review -> submit', async () => {
    const page = new FixturePage(pages);
    const r = await runWorkdayApply(page, entry, payload, 'live');
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.submitted).toBe(true);
    expect(r.filledFields).toEqual(
      expect.arrayContaining(['name', 'email', 'phone', 'resume_upload']),
    );
    expect(
      page.calls.filter((c) => c.selector.includes('bottom-navigation-next-button')),
    ).toHaveLength(3);
  });

  it('dry-run: stops before submit', async () => {
    const page = new FixturePage(pages);
    const r = await runWorkdayApply(page, entry, payload, 'dry-run');
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.submitted).toBe(false);
    expect(page.calls.some((c) => c.selector.includes('submit-button'))).toBe(false);
  });
});

describe('single-page flows (lever + greenhouse)', () => {
  it('lever dry-run fills every field, never submits', async () => {
    const entry = loadEntry('lever');
    const page = new FixturePage(loadFixtures('lever/apply.html'));
    const r = await runLeverApply(page, entry, payload, 'dry-run');
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.submitted).toBe(false);
    expect(r.filledFields).toEqual(
      expect.arrayContaining(['name', 'email', 'phone', 'resume_upload']),
    );
  });

  it('greenhouse live submits and waits for the confirmation', async () => {
    const entry = loadEntry('greenhouse');
    const page = new FixturePage(loadFixtures('greenhouse/apply.html'));
    const r = await runGreenhouseApply(page, entry, payload, 'live');
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.submitted).toBe(true);
    expect(
      page.calls.some((c) => c.selector === '#application-confirmation, .application-confirmation'),
    ).toBe(true);
  });
});

describe('runApplyFlow defaults', () => {
  it('falls back to the flat entry selectors for a single-screen entry', async () => {
    const entry: AllowlistEntry = {
      domain: 'example.com',
      allowed_paths: ['/'],
      forbidden_selectors: [],
      required_headers: [],
      field_selectors: { name: 'input[name=name]' },
      submit_selector: 'button[type=submit]',
      success_signal: '.ok',
    };
    const page = new FixturePage([
      '<html><body><input name="name"/><button type="submit"></button><div class="ok"></div></body></html>',
    ]);
    const r = await runApplyFlow(page, entry, { name: 'A' }, 'live');
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.submitted).toBe(true);
  });

  it('honours a step-level submit control (workday/indeed YAML shape)', async () => {
    const entry: AllowlistEntry = {
      domain: 'example.com',
      allowed_paths: ['/'],
      forbidden_selectors: [],
      required_headers: [],
      field_selectors: { name: 'input[name=name]' },
      submit_selector: 'button#flat-submit',
      apply_flow: {
        steps: [
          { name: 'review', submit: 'button#step-submit' },
        ],
        success: '.ok',
      },
    };
    const page = new FixturePage([
      '<html><body><input name="name"/><button id="step-submit"></button><button id="flat-submit"></button><div class="ok"></div></body></html>',
    ]);
    const r = await runApplyFlow(page, entry, { name: 'A' }, 'live');
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.submitted).toBe(true);
    expect(page.calls.some((c) => c.op === 'click' && c.selector === 'button#step-submit')).toBe(true);
    expect(page.calls.some((c) => c.selector === 'button#flat-submit')).toBe(false);
  });

  it('refuses to submit when the terminal step submit is a forbidden selector', async () => {
    const entry: AllowlistEntry = {
      domain: 'example.com',
      allowed_paths: ['/'],
      forbidden_selectors: ['button#step-submit'],
      required_headers: [],
      field_selectors: { name: 'input[name=name]' },
      apply_flow: { steps: [{ name: 'review', submit: 'button#step-submit' }] },
    };
    const page = new FixturePage([
      '<html><body><input name="name"/><button id="step-submit"></button></body></html>',
    ]);
    const r = await runApplyFlow(page, entry, { name: 'A' }, 'live');
    expect(r.status).toBe('selector-broken');
    if (r.status !== 'selector-broken') return;
    expect(r.missing.some((m) => m.includes('forbidden selector'))).toBe(true);
    expect(page.calls.some((c) => c.op === 'click' && c.selector === 'button#step-submit')).toBe(false);
  });
});
