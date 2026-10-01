import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultAllowlistDir, loadAllowlistDir, loadAllowlistFile } from './loader';

describe('allowlist loader', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'careeros-allowlist-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('loads a valid yaml file', () => {
    const path = join(dir, 'example.yaml');
    writeFileSync(
      path,
      [
        'domain: example.com',
        'allowed_paths:',
        '  - /jobs',
        'forbidden_selectors:',
        '  - input[type=password]',
        'required_headers:',
        '  - user-agent',
      ].join('\n'),
    );
    const entry = loadAllowlistFile(path);
    expect(entry.domain).toBe('example.com');
    expect(entry.allowed_paths).toEqual(['/jobs']);
  });

  it('rejects malformed yaml', () => {
    const path = join(dir, 'bad.yaml');
    writeFileSync(path, 'domain: [unclosed\n');
    expect(() => loadAllowlistFile(path)).toThrow();
  });

  it('rejects yaml missing required fields', () => {
    const path = join(dir, 'partial.yaml');
    writeFileSync(path, 'domain: example.com\n');
    expect(() => loadAllowlistFile(path)).toThrow();
  });

  it('throws on missing file', () => {
    expect(() => loadAllowlistFile(join(dir, 'nope.yaml'))).toThrow();
  });

  it('loadAllowlistDir picks up every yaml/yml, skips others', () => {
    writeFileSync(
      join(dir, 'a.yaml'),
      'domain: a.com\nallowed_paths: []\nforbidden_selectors: []\nrequired_headers: []\n',
    );
    writeFileSync(
      join(dir, 'b.yml'),
      'domain: b.com\nallowed_paths: []\nforbidden_selectors: []\nrequired_headers: []\n',
    );
    writeFileSync(join(dir, 'README.md'), '# ignore');
    const entries = loadAllowlistDir(dir);
    expect([...entries.keys()].sort()).toEqual(['a.com', 'b.com']);
  });

  it('ships all phase-3.5 domains plus the F.3 generic fallback at the default location', () => {
    const entries = loadAllowlistDir(defaultAllowlistDir());
    expect([...entries.keys()].sort()).toEqual(
      ['*', 'ashbyhq.com', 'greenhouse.io', 'indeed.com', 'linkedin.com', 'naukri.com'],
    );
    for (const e of entries.values()) {
      expect(e.allowed_paths.length).toBeGreaterThan(0);
      expect(e.forbidden_selectors).toContain('input[type=password]');
    }
  });

  it('accepts entries with F.3 field_selectors + submit_selector blocks', () => {
    const entries = loadAllowlistDir(defaultAllowlistDir());
    const ashby = entries.get('ashbyhq.com');
    expect(ashby?.field_selectors?.email).toBeDefined();
    expect(ashby?.submit_selector).toBeDefined();
    expect(ashby?.success_signal).toBeDefined();
    const greenhouse = entries.get('greenhouse.io');
    expect(greenhouse?.field_selectors?.resume_upload).toBeDefined();
    expect(greenhouse?.submit_selector).toBeDefined();
  });
});
