import { describe, expect, it } from 'vitest';
import type { AllowlistEntry } from '../allowlist/loader';
import { collectProbeSelectors, probeEntry } from './probe';

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

const healthyFixture = `
  <html><body>
    <form>
      <input name="_systemfield_name"/>
      <input name="_systemfield_email"/>
      <input type="file" name="_systemfield_resume"/>
      <button type="submit">Apply</button>
    </form>
    <div data-testid="application-confirmation"></div>
  </body></html>
`;

const staleFixture = `
  <html><body>
    <form>
      <input name="full_name"/>
      <input name="candidate_email"/>
    </form>
  </body></html>
`;

describe('collectProbeSelectors', () => {
  it('includes field_selectors + submit + success in stable order', () => {
    const sels = collectProbeSelectors(ashbyEntry);
    expect(sels[0]).toBe('input[name=_systemfield_name]');
    expect(sels).toContain('button[type=submit]');
    expect(sels).toContain('[data-testid=application-confirmation]');
  });

  it('returns empty for stub entries (no field_selectors)', () => {
    const stub: AllowlistEntry = {
      domain: 'stub.com',
      allowed_paths: ['/'],
      forbidden_selectors: [],
      required_headers: [],
    };
    expect(collectProbeSelectors(stub)).toEqual([]);
  });
});

describe('probeEntry', () => {
  it('reports healthy against a complete fixture', () => {
    const r = probeEntry(ashbyEntry, healthyFixture);
    expect(r.healthy).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.domain).toBe('ashbyhq.com');
  });

  it('reports every missing selector against a stale fixture', () => {
    const r = probeEntry(ashbyEntry, staleFixture);
    expect(r.healthy).toBe(false);
    expect(r.missing.length).toBeGreaterThanOrEqual(3);
  });

  it('treats stub entries as healthy (nothing to probe yet)', () => {
    const stub: AllowlistEntry = {
      domain: 'stub.com',
      allowed_paths: ['/'],
      forbidden_selectors: [],
      required_headers: [],
    };
    const r = probeEntry(stub, '<html></html>');
    expect(r.healthy).toBe(true);
    expect(r.probedSelectors).toEqual([]);
  });
});
